// Minimal `process` for the logger bundled inside @meshtastic/core.
export const process = { env: {}, cwd: () => "/", platform: "browser", versions: {}, stdout: { write: (s) => console.log(s) }, stderr: { write: (s) => console.error(s) } };
