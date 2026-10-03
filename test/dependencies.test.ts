import { describe, expect, it } from "vitest";
import lock from "../package-lock.json";
import manifest from "../package.json";

// Each override is scoped to the exact version of the package that pins a
// vulnerable dependency, so it stops applying once that package moves on.
// This then fails, so the leftover override gets removed.
describe("dependency overrides", () => {
  const packages: Record<string, { version?: string }> = lock.packages;

  it.each(Object.keys(manifest.overrides))("%s targets an installed package version", (key) => {
    const [, name, version] = key.match(/^(.+)@([^@]+)$/) ?? [];
    expect(name, `${key} must be scoped as name@version`).toBeDefined();
    const installed = Object.entries(packages).some(([path, meta]) => path.endsWith(`node_modules/${name}`) && meta.version === version);
    expect(installed, `${key} no longer matches an installed package; remove the override`).toBe(true);
  });
});
