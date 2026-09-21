// The seam the outbound clients are built on: tests pass a fake in place of
// the global `fetch` without going near the network.
export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

// Wrapped rather than passed by reference: calling a stored `fetch` as a
// method throws "Illegal invocation" in workerd.
export const globalFetch: Fetch = (input, init) => fetch(input, init);
