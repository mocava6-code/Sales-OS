// Vitest never goes through Next.js's bundler, which is the only thing that
// makes the real "server-only" package a no-op on the server side (it
// throws unconditionally otherwise, by design, to catch client-bundle
// leaks). Every test in this suite already runs under Node with
// environment: "node", so there's no client bundle to protect against —
// this shim just makes the import inert. See vitest.config.ts's alias.
export {};
