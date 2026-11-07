import type { OrchestrationV2ProviderFailure } from "@t3tools/contracts";
import { makeProviderFailure } from "@t3tools/provider-core/server/failure";
import * as EffectAcpErrors from "effect-acp/errors";
import * as Schema from "effect/Schema";

const isAcpRequestError = Schema.is(EffectAcpErrors.AcpRequestError);

const QUOTA_MESSAGE = /(quota|rate[_\s-]?limit|usage[_\s-]?limit|too many requests|429|budget|credits? (exhausted|spent)|daily budget)/i;

/**
 * Slice 5 closes the "usage limits are not generic failures" trap: quota or
 * rate-limit shaped ACP errors classify as `usage_limit` so the thread shows
 * Limited (with a reset time when the provider gives one) instead of a
 * generic provider error. Anything else stays `provider_error`.
 */
export const classifyDshPromptFailure = (cause: unknown): OrchestrationV2ProviderFailure => {
  if (!isAcpRequestError(cause)) return makeProviderFailure({ cause, class: "provider_error" });
  const code = cause.code;
  const message = cause.errorMessage;
  const dataText = (() => {
    try {
      return JSON.stringify(cause.data);
    } catch {
      return "";
    }
  })();
  const shaped =
    code === 429 || (typeof code === "number" && code === -32003)
    || QUOTA_MESSAGE.test(message)
    || QUOTA_MESSAGE.test(dataText);
  return makeProviderFailure({
    cause,
    message,
    code: String(code),
    class: shaped ? "usage_limit" : "provider_error",
  });
};
