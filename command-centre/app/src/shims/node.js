// Browser stubs for Node built-ins referenced by the logger inside @meshtastic/core.
export const hostname = () => "browser";
export const normalize = (p) => p;
export const formatWithOptions = (_o, ...a) => a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ");
export const types = { isError: (e) => e instanceof Error, isNativeError: (e) => e instanceof Error };
export const inspect = (x) => JSON.stringify(x);
export default { hostname, normalize, formatWithOptions, types, inspect };
