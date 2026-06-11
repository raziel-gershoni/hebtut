/**
 * Telegram Bot API error classifiers. grammY surfaces API failures as
 * Error messages shaped like:
 *   Call to 'sendMessage' failed! (400: Bad Request: <CODE>)
 * so we match on the embedded code string.
 */

/**
 * True when the failure is the privacy gate Telegram applies to "open
 * profile" buttons (inline `tg://user?id=` URL / inputKeyboardButtonUserProfile)
 * for a user whose settings forbid being linked. Crucially distinct from an
 * invalid-id failure (PEER_ID_INVALID / USER_ID_INVALID): this code only
 * fires when the id resolved to a real user who opted out — so seeing it
 * also confirms we sent a valid Telegram id, not an internal one.
 */
export function isButtonPrivacyError(message: string): boolean {
  return message.includes("BUTTON_USER_PRIVACY_RESTRICTED");
}
