// Verify that CLI credentials are read without being changed or refreshed.
import GLib from 'gi://GLib';
import {UsageClient, UsageError, SignedOutError} from '../src/lib/usageClient.js';

const dir = GLib.dir_make_tmp('agy-usage-test-XXXXXX');
const path = GLib.build_filenamev([dir, 'antigravity-oauth-token']);
const client = new UsageClient({configDir: dir});

try {
    const current = JSON.stringify({token: {
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        expiry: new Date(Date.now() + 60_000).toISOString(),
    }});
    GLib.file_set_contents(path, current);
    if (await client._resolveToken() !== 'test-access-token')
        throw new Error('Current CLI access token was not read');
    const [, bytes] = GLib.file_get_contents(path);
    if (new TextDecoder().decode(bytes) !== current)
        throw new Error('CLI credential file was modified');

    GLib.file_set_contents(path, JSON.stringify({token: {
        access_token: 'expired-access-token',
        refresh_token: 'test-refresh-token',
        expiry: new Date(Date.now() - 60_000).toISOString(),
    }}));
    try {
        await client._resolveToken();
        throw new Error('Expired token was accepted');
    } catch (error) {
        if (!(error instanceof UsageError) || error.status !== 401)
            throw error;
    }

    GLib.unlink(path);
    try {
        await client._resolveToken();
        throw new Error('Missing credentials were accepted');
    } catch (error) {
        if (!(error instanceof SignedOutError))
            throw error;
    }
    print('Read-only credential checks passed');
} finally {
    GLib.unlink(path);
    GLib.rmdir(dir);
}
