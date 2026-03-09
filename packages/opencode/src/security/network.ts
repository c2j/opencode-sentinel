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

      const allowed = network.whitelist.some((domain: string) => {
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
