# Modification Log

## 1. 🛡️ Network Security Policy

A new centralized `NetworkPolicy` system has been implemented to control outbound traffic.

### `packages/opencode/src/config/config.ts`

Extended the configuration schema to include network policies.

```typescript
@@ -1024,6 +1025,14 @@ export namespace Config {
          url: z.string().optional().describe("Enterprise URL"),
        })
        .optional(),
+      network: z
+        .object({
+          policy: z.enum(["allow-all", "deny-all", "whitelist"]).default("deny-all").describe("Network access policy"),
+          whitelist: z.array(z.string()).default([]).describe("List of allowed domains for whitelist policy"),
+          proxy: z.string().optional().describe("Proxy URL for network requests"),
+        })
+        .default({})
+        .describe("Network configuration and security policies"),
      compaction: z
        .object({
          auto: z.boolean().optional().describe("Enable automatic compaction when context is full (default: true)"),
```

### `packages/opencode/src/security/network.ts` (New File)

Created a dedicated module for policy enforcement.

```typescript
import { Config } from "../config/config"
import { Log } from "../util/log"

export namespace NetworkPolicy {
  const log = Log.create({ service: "security" })

  export class AccessDeniedError extends Error {
    constructor(message: string) {
      super(message)
      this.name = "AccessDeniedError"
    }
  }

  /**
   * Checks if network access to the given URL is allowed by the current configuration.
   * Throws AccessDeniedError if access is denied.
   * @param url The URL to check
   * @param configOverride Optional configuration object to use instead of loading from Config.get()
   */
  export async function checkAccess(url: string | URL, configOverride?: any): Promise<void> {
    const config = configOverride || await Config.get()
    const network = config.network

    // If explicitly allowed, return immediately
    if (network?.policy === "allow-all") {
      return
    }

    // Default policy is deny-all if not configured or explicitly set to deny-all
    if (!network || !network.policy || network.policy === "deny-all") {
      throw new AccessDeniedError("Network access is disabled by 'deny-all' policy (default).")
    }

    if (network.policy === "whitelist") {
      let targetUrl: URL
      try {
        targetUrl = typeof url === "string" ? new URL(url) : url
      } catch (e) {
        throw new Error(`Invalid URL provided for network check: ${url}`)
      }

      const hostname = targetUrl.hostname

      const allowed = network.whitelist.some((domain) => {
        // Exact match or subdomain match (e.g., api.example.com matches example.com)
        return hostname === domain || hostname.endsWith("." + domain)
      })

      if (!allowed) {
        log.warn("Network access blocked by whitelist", {
          hostname,
          whitelist: network.whitelist
        })
        throw new AccessDeniedError(
          `Network access to '${hostname}' is not allowed by whitelist policy.`
        )
      }
    }
  }

  /**
   * Returns true if access is allowed, false otherwise.
   * Does not throw.
   */
  export async function isAccessAllowed(url: string | URL, configOverride?: any): Promise<boolean> {
    try {
        await checkAccess(url, configOverride)
        return true
    } catch {
        return false
    }
  }
}
```

### Integration Examples

Updated various tools to use the new policy check.

**`packages/opencode/src/tool/webfetch.ts`**
```typescript
@@ -1,4 +1,4 @@
  import z from "zod"
- import { Config } from "../config/config"
+ import { NetworkPolicy } from "../security/network"
  import { Tool } from "./tool"
  import TurndownService from "turndown"
@@ -25,19 +25,5 @@
      }

-     const config = await Config.get()
-     if (config.network) {
-       // ... old logic removed ...
-     }
+     await NetworkPolicy.checkAccess(params.url)

      await ctx.ask({
```

## 2. 🔄 LLM Reliability & Fallback

Implemented automatic fallback to a secondary model when the primary fails.

### `packages/opencode/src/config/config.ts`

Added `fallback_model` configuration.

```typescript
@@ -909,6 +909,7 @@ export namespace Config {
        .optional()
        .describe("When set, ONLY these providers will be enabled. All other providers will be ignored"),
      model: z.string().describe("Model to use in the format of provider/model, eg anthropic/claude-2").optional(),
+      fallback_model: z.string().optional().describe("Fallback model to use if the primary model fails"),
      small_model: z
        .string()
        .describe("Small model to use for tasks like title generation in the format of provider/model")
```

### `packages/opencode/src/session/llm.ts`

Added robust retry logic with loop prevention.

```typescript
@@ -52,28 +52,40 @@
        return await _stream(input, cfg)
      } catch (error) {
-       if (cfg.fallback_model) {
-         log.warn("stream failed, attempting fallback", {
+       if (!cfg.fallback_model) {
+         throw error
+       }
+
+       const { providerID, modelID } = Provider.parseModel(cfg.fallback_model)
+
+       // Prevent infinite loops if the current model is already the fallback model
+       if (input.model.providerID === providerID && input.model.id === modelID) {
+         log.warn("Fallback model failed (same as primary)", {
            model: input.model.id,
-           fallback: cfg.fallback_model,
            error,
          })
-         try {
-           // ... old simple retry ...
-         } catch (fallbackError) {
-           // ...
-         }
+         throw error
+       }
+
+       log.warn("stream failed, attempting fallback", {
+         model: input.model.id,
+         fallback: cfg.fallback_model,
+         error,
+       })
+
+       try {
+         const fallbackModel = await Provider.getModel(providerID, modelID)

-           return await _stream(
-             {
-               ...input,
-               model: fallbackModel,
-             },
-             cfg,
-           )
+         return await _stream(
+           {
+             ...input,
+             model: fallbackModel,
+           },
+           cfg,
+         )
+       } catch (fallbackError) {
+         log.error("fallback stream failed", { error: fallbackError })
+         // If fallback fails, throw the original error to indicate the primary failure
+         throw error
+       }
-       throw error
      }
    }
```

## 3. 📦 Offline Packaging System

A comprehensive tooling suite has been added to support air-gapped deployments.

### `offline-scripts/pack.ts` (New File)

Automates the creation of a self-contained installation bundle.

- **Dependency Bundling**: Pre-downloads specific Node.js binaries (v20.11.0) for Windows, Linux, and macOS.
- **Dependency Resolution**: Creates a local `node_modules` with all required runtime dependencies (e.g., `@opencode-ai/plugin`, `opencode-anthropic-auth`).
- **Build Process**: Triggers the core `packages/opencode/script/build.ts` to generate platform-specific binaries.
- **Compression**: Packages everything into `opencode-offline.tar.gz`.

### `offline-scripts/install.sh` (New File)

Target machine installer for Linux and macOS.

- **Environment Setup**: Extracts the bundled Node.js and adds it to the user's PATH.
- **Binary Setup**: Installs the `opencode` binary.
- **Dependency Hydration**: Populates the local cache (`~/.cache/opencode` or `~/.config/opencode`) with the pre-bundled `node_modules`, ensuring plugins work without internet access.

### `offline-scripts/install.ps1` (New File)

Target machine installer for Windows (PowerShell).

- Performs equivalent setup operations for Windows environments.
- Updates **User PATH** to include the portable Node.js and OpenCode binaries.
- Hydrates dependency caches in both `%LOCALAPPDATA%` and `%APPDATA%`.
