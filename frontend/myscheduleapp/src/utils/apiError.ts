// src/utils/apiError.ts
/**
 * A human-readable reason for a failed request. Prefers the server's own message
 * ("AI isn't configured on this server…"), and otherwise says what went wrong on the
 * network (timeout / unreachable server) instead of a generic "error".
 */
export function describeApiError(e: any, fallback = 'Something went wrong.'): string {
    const serverMsg = e?.response?.data?.error;
    if (typeof serverMsg === 'string' && serverMsg.trim()) return serverMsg;
    if (e?.response?.status === 403) return "Your account doesn't have access to this.";
    if (e?.code === 'ECONNABORTED' || /timeout/i.test(e?.message ?? '')) {
        return 'The request took too long. Please try again.';
    }
    if (e?.request && !e?.response) {
        return "Can't reach the ProShifts server. Check your connection.";
    }
    return fallback;
}
