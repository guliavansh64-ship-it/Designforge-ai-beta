# Connecting Google Stitch (end-user guide)

DesignForge generates screens **in your own Google Stitch account, using your own quota**. We never use a shared or admin key, and we never ask for your Google password.

> Signing in to DesignForge with Google does **not** give us Stitch access. Connecting Stitch is a separate step that you approve explicitly.

## 1. Create a Stitch API key
1. Open **https://stitch.withgoogle.com** and sign in with your Google account. Open Stitch at least once so that your account is provisioned.
2. Go to **Settings → API keys → Create key**.
3. Copy the key.

## 2. Connect it in DesignForge
- **Web:** Integrations → Google Stitch → *Connect* → paste the key → tick the authorization box → *Verify & connect*.
- **Android:** Settings → Integrations → *Connect*. It works the same way; the key goes straight to our server over HTTPS and is **not stored on the phone**.

The server checks the key with a read-only call (it lists your projects), encrypts it with AES-256-GCM bound to your user ID, and then forgets the plaintext. From then on you only see `••••last4`.

## 3. Logo Studio (optional): Gemini key
Stitch generates UI screens, **not standalone images**. Logo Studio uses Google's Gemini image model, so it needs a separate key from **https://aistudio.google.com/app/apikey**. Connect it under Integrations → Gemini. Gemini image generation may need billing enabled on your Google AI Studio project, depending on Google's current terms.

## Status meanings
| Status | Meaning | What to do |
|---|---|---|
| Active | Verified recently | Nothing |
| Invalid | Google rejected the key, or it can no longer be decrypted | Create a new key → *Replace* |
| Quota exceeded | Your Stitch/Gemini quota is used up | Wait for the reset (Google sets this) or use another account |
| No access | Your account has no Stitch access (403) | Open stitch.withgoogle.com once, or check region/age eligibility |

## Disconnect / revoke
*Disconnect* deletes the encrypted key from DesignForge immediately. For full safety, also delete the key at the source using the link shown (Stitch settings or AI Studio).

## Quotas: be aware
Stitch's free quota is set by Google and can change (it was reported at roughly 350 generations/month at the time of writing). **DesignForge credits are separate** from it. Credits pay for DesignForge processing (audits, exports, queueing), while Google's quota limits how many Stitch calls your account can make.
