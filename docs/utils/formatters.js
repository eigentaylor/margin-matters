'use strict';

export function fmtLean(x) {
    if (!isFinite(x)) return '';
    if (Math.abs(x) < 0.000005) return 'EVEN';
    const s = (Math.abs(x) * 100).toFixed(1);
    return (x > 0 ? 'D+' : 'R+') + s;
}
export const formatter = (x) => isFinite(x) ? Math.round(x).toLocaleString('en-US') : '0';


export function leanStr(x) {
    if (!isFinite(x)) return '';
    if (Math.abs(x) < 0.000005) return 'EVEN';
    const s = (Math.abs(x) * 100).toFixed(1);
    return (x > 0 ? 'D+' : 'R+') + s;
}