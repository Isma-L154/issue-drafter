import { describe, expect, it } from "vitest";
import lock from "../package-lock.json";
import manifest from "../package.json";

// Each override is scoped to the exact version of the package that pins a
// vulnerable dependency, so it stops applying once that package moves on.
// This then fails, so the leftover override gets removed.
// Several versions of one package share a key ("name@1.0.0 || 2.0.0") because
// npm keeps only one of two overrides for the same name.
describe("dependency overrides", () => {
  const packages: Record<string, { version?: string }> = lock.packages;

  it.each(Object.keys(manifest.overrides))("%s targets installed package versions", (key) => {
    const [, name, versions = ""] = key.match(/^(.+)@([^@]+)$/) ?? [];
    expect(name, `${key} must be scoped as name@version`).toBeDefined();
    for (const version of versions.split("||").map((v) => v.trim())) {
      const installed = Object.entries(packages).some(([path, meta]) => path.endsWith(`node_modules/${name}`) && meta.version === version);
      expect(installed, `${name}@${version} is no longer installed; remove it from the override`).toBe(true);
    }
  });
});
