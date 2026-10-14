// Pure data-shaping for the usage endpoint: turns the API payload into the
// ordered list of windows the popup renders, and normalises the spend / extra-
// usage money block. No GI or shell imports, so it runs under plain `node` and
// `gjs` and is unit-testable in isolation (see tools/poll.js and the tests).

const FIVE_HOUR_SECONDS = 5 * 3600;
const SEVEN_DAY_SECONDS = 7 * 24 * 3600;
export const GROUP_SECONDS = {session: FIVE_HOUR_SECONDS, weekly: SEVEN_DAY_SECONDS, '5h': FIVE_HOUR_SECONDS};

export function apiSeverityLevel(sev) {
    switch (sev) {
    case 'critical':
        return 'crit';
    case 'warning':
        return 'warn';
    default:
        return 'ok';
    }
}

function humanizeToken(s) {
    return String(s ?? '')
        .split(/[_\s]+/)
        .filter(Boolean)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

const KNOWN_MODEL = {
    opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku',
    gemini: 'Gemini', flash: 'Flash', pro: 'Pro', ultra: 'Ultra',
};
export function modelLabel(name) {
    return KNOWN_MODEL[name] ?? humanizeToken(name);
}

export function limitLabel(entry) {
    const model = entry?.scope?.model?.display_name;
    const surface = entry?.scope?.surface;
    let base;
    switch (entry?.kind) {
    case 'session':
        base = '5-hour';
        break;
    case 'weekly_all':
        base = '7-day (all models)';
        break;
    case 'weekly_scoped':
        base = model ? `7-day ${model}` : '7-day (scoped)';
        break;
    default:
        base = humanizeToken(entry?.kind || entry?.group || 'usage');
        if (model)
            base += ` ${model}`;
    }
    if (surface)
        base += ` · ${humanizeToken(surface)}`;
    return base;
}

export function limitKey(entry) {
    const parts = ['limit', entry?.kind ?? '?', entry?.group ?? '?'];
    const model = entry?.scope?.model?.display_name ?? entry?.scope?.model?.id;
    if (model)
        parts.push(model);
    if (entry?.scope?.surface)
        parts.push(entry.scope.surface);
    return parts.join(':');
}

function limitRole(entry) {
    if (entry?.kind === 'session' || entry?.group === 'session' || entry?.group === '5h')
        return 'session';
    if (entry?.kind === 'weekly_scoped')
        return 'scoped';
    if (entry?.kind === 'weekly_all' || entry?.group === 'weekly')
        return 'weekly';
    return 'other';
}

const ROLE_ORDER = {session: 0, weekly: 1, scoped: 2, other: 3};

function fromLimit(entry) {
    const role = limitRole(entry);
    const totalSeconds = GROUP_SECONDS[entry.group] ??
        (role === 'scoped' || role === 'weekly' ? SEVEN_DAY_SECONDS
            : role === 'session' ? FIVE_HOUR_SECONDS : null);
    return {
        key: limitKey(entry),
        label: limitLabel(entry),
        role,
        utilization: Number(entry.percent),
        resetsAt: entry.resets_at ?? null,
        totalSeconds,
        apiLevel: apiSeverityLevel(entry.severity),
        isActive: !!entry.is_active,
        order: ROLE_ORDER[role],
    };
}

function legacyWindow(key, label, role, win, totalSeconds) {
    return {
        key: `legacy:${key}`,
        label,
        role,
        utilization: Number(win.utilization),
        resetsAt: win.resets_at ?? null,
        totalSeconds,
        apiLevel: 'ok',
        isActive: false,
        order: ROLE_ORDER[role],
    };
}

// Converts Antigravity retrieveUserQuotaSummary groups & buckets
function fromAntigravityBucket(bucket, group, isPrimaryGroup) {
    const windowName = String(bucket.window ?? bucket.bucketId ?? '').toLowerCase();
    const is5h = /(?:5h|5.hour|session)/.test(windowName);
    const isWeekly = /(?:7d|7.day|week)/.test(windowName);
    const role = isPrimaryGroup
        ? (is5h ? 'session' : isWeekly ? 'weekly' : 'other')
        : (is5h || isWeekly ? 'scoped' : 'other');
    const totalSeconds = is5h ? FIVE_HOUR_SECONDS : isWeekly ? SEVEN_DAY_SECONDS : null;
    const period = is5h ? '5-hour' : isWeekly ? '7-day' : null;

    // Remaining fraction -> utilization percentage
    const rem = bucket.remainingFraction != null ? Number(bucket.remainingFraction) : null;
    const percent = bucket.percent != null ? Number(bucket.percent) : null;
    const rawUtilization = Number.isFinite(rem) ? (1 - rem) * 100 : percent;
    if (!Number.isFinite(rawUtilization))
        return null;
    const utilization = Math.max(0, Math.min(100, Math.round(rawUtilization * 10) / 10));

    let label = bucket.displayName || period || 'Usage limit';
    if (!isPrimaryGroup && group.displayName)
        label = period ? `${period} (${group.displayName})` : `${label} (${group.displayName})`;
    else if (isPrimaryGroup && period)
        label = `${period} (Gemini)`;

    const key = `agy:${bucket.bucketId || (role + ':' + (group.displayName || ''))}`;
    const apiLevel = bucket.severity ? apiSeverityLevel(bucket.severity)
        : (utilization >= 90 ? 'crit' : utilization >= 75 ? 'warn' : 'ok');

    return {
        key,
        label,
        role,
        utilization,
        resetsAt: bucket.resetTime ?? bucket.resets_at ?? null,
        totalSeconds,
        apiLevel,
        isActive: utilization > 0,
        order: ROLE_ORDER[role],
    };
}

// The ordered list of windows to display. Prefers the Antigravity quota
// groups; falls back to limits[] or legacy flat keys for compatibility.
// Entries without a numeric utilization are dropped.
export function normalizeWindows(usage) {
    if (Array.isArray(usage?.groups) && usage.groups.length) {
        const out = [];
        usage.groups.forEach(group => {
            if (!Array.isArray(group?.buckets))
                return;
            const isPrimary = /gemini/i.test(group.displayName || '');
            for (const b of group.buckets) {
                if (b && (b.remainingFraction != null || b.percent != null)) {
                    const window = fromAntigravityBucket(b, group, isPrimary);
                    if (window)
                        out.push(window);
                }
            }
        });
        if (out.length) {
            out.sort((a, b) => a.order - b.order || a.totalSeconds - b.totalSeconds);
            return out;
        }
    }

    const limits = usage?.limits;
    if (Array.isArray(limits) && limits.length) {
        const out = limits
            .filter(l => l && l.percent != null && Number.isFinite(Number(l.percent)))
            .map(fromLimit);
        if (out.length) {
            out.sort((a, b) => a.order - b.order);
            return out;
        }
    }

    const out = [];
    if (usage?.five_hour)
        out.push(legacyWindow('five_hour', '5-hour', 'session', usage.five_hour, FIVE_HOUR_SECONDS));
    if (usage?.seven_day)
        out.push(legacyWindow('seven_day', '7-day', 'weekly', usage.seven_day, SEVEN_DAY_SECONDS));
    for (const key of Object.keys(usage ?? {})) {
        const m = /^seven_day_(.+)$/.exec(key);
        const win = usage[key];
        if (m && win)
            out.push(legacyWindow(key, `7-day ${modelLabel(m[1])}`, 'scoped', win, SEVEN_DAY_SECONDS));
    }
    return out;
}

function formatMinor(m) {
    if (!m || !Number.isFinite(Number(m.amount_minor)))
        return null;
    const exp = Number.isFinite(Number(m.exponent)) ? Number(m.exponent) : 2;
    const value = Number(m.amount_minor) / Math.pow(10, exp);
    const cur = m.currency ? `${m.currency} ` : '';
    return `${cur}${value.toFixed(exp)}`;
}

export function normalizeSpend(usage) {
    const spend = usage?.spend;
    if (spend && spend.enabled) {
        const used = formatMinor(spend.used);
        const limit = formatMinor(spend.limit) ?? formatMinor(spend.cap?.money) ?? formatMinor(spend.cap?.credits);
        if (used || limit) {
            return {
                used: used ?? null,
                limit: limit ?? null,
                percent: Number.isFinite(Number(spend.percent)) ? Number(spend.percent) : null,
                level: apiSeverityLevel(spend.severity),
            };
        }
    }

    const xu = usage?.extra_usage;
    if (xu && xu.is_enabled) {
        const places = Number.isFinite(Number(xu.decimal_places)) ? Number(xu.decimal_places) : 2;
        const div = Math.pow(10, places);
        const cur = xu.currency ? `${xu.currency} ` : '';
        const money = v => Number.isFinite(v) ? `${cur}${(v / div).toFixed(places)}` : null;
        const used = money(Number(xu.used_credits));
        const limit = Number(xu.monthly_limit) > 0 ? money(Number(xu.monthly_limit)) : null;
        if (used || limit) {
            return {
                used: used ?? `${cur}${(0).toFixed(places)}`,
                limit,
                percent: Number.isFinite(Number(xu.utilization)) ? Math.round(Number(xu.utilization)) : null,
                level: 'ok',
            };
        }
    }
    return null;
}

export const PANEL_SELECTORS = ['five-hour', 'seven-day', 'scoped', 'max', 'worst'];

export function migratePanelWindows(settings) {
    if (settings.get_user_value('panel-windows') !== null)
        return;
    if (settings.get_user_value('panel-window') === null)
        return;
    const old = settings.get_string('panel-window');
    if (PANEL_SELECTORS.includes(old))
        settings.set_strv('panel-windows', [old]);
}

export function selectPanelWindows(windows, selectors, worstScore = w => Number(w.utilization) || 0) {
    if (!Array.isArray(windows) || !windows.length)
        return [];
    const picked = new Set();
    const highest = pool => pool.reduce((best, w) =>
        (Number(w.utilization) || 0) > (Number(best.utilization) || 0) ? w : best);
    for (const sel of selectors ?? []) {
        switch (sel) {
        case 'five-hour': {
            const w = windows.find(x => x.role === 'session');
            if (w)
                picked.add(w.key);
            break;
        }
        case 'seven-day': {
            const w = windows.find(x => x.role === 'weekly');
            if (w)
                picked.add(w.key);
            break;
        }
        case 'scoped':
            for (const w of windows) {
                if (w.role === 'scoped')
                    picked.add(w.key);
            }
            break;
        case 'max':
            picked.add(highest(windows).key);
            break;
        case 'worst': {
            const active = windows.filter(w => w.isActive);
            const pool = active.length ? active : windows;
            const w = pool.reduce((best, x) => (worstScore(x) > worstScore(best) ? x : best));
            picked.add(w.key);
            break;
        }
        default:
            break;
        }
    }
    const out = windows.filter(w => picked.has(w.key));
    return out.length ? out : [windows[0]];
}

const RESET_MERGE_MS = 5 * 60 * 1000;
const isWeekly = w => w?.role === 'weekly' ||
    (w?.role === 'scoped' && (w.totalSeconds == null || w.totalSeconds >= 24 * 3600));

function resetMs(iso) {
    const t = iso ? Date.parse(iso) : NaN;
    return Number.isNaN(t) ? null : t;
}

export function groupPanelWindows(windows) {
    const groups = [];
    const weekly = [];
    for (const w of windows ?? []) {
        const ms = resetMs(w.resetsAt);
        if (isWeekly(w)) {
            const home = ms === null
                ? weekly.at(-1)
                : weekly.find(g => g.ms === null || Math.abs(g.ms - ms) <= RESET_MERGE_MS);
            if (home) {
                home.group.windows.push(w);
                if (home.ms === null && ms !== null) {
                    home.ms = ms;
                    home.group.resetsAt = w.resetsAt;
                }
                continue;
            }
        }
        const group = {windows: [w], resetsAt: ms === null ? null : w.resetsAt};
        groups.push(group);
        if (isWeekly(w))
            weekly.push({group, ms});
    }
    return groups;
}

export const TIER_ICONS = ['free', 'pro', 'ultra', 'max', 'team', 'enterprise'];

export function tierIconName(label) {
    const slug = String(label ?? '').trim().toLowerCase().replace(/\s+/g, '-');
    return [slug, slug.split('-')[0]].find(name => TIER_ICONS.includes(name)) ?? null;
}

export function windowTag(w) {
    switch (w?.role) {
    case 'session':
        return '5h';
    case 'weekly':
        return '7d';
    case 'scoped': {
        const name = String(w.label ?? '')
            .replace(/^7-day\s+/, '')
            .replace(/^5-hour\s+/, '')
            .replace(/\s+·.*$/, '')
            .replace(/^\((.*)\)$/, '$1') || 'Model';
        if (w.key?.startsWith('agy:') && w.totalSeconds)
            return `${w.totalSeconds === FIVE_HOUR_SECONDS ? '5h' : '7d'} ${name}`;
        return name;
    }
    default:
        return String(w?.label ?? '');
    }
}
