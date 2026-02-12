const GHL_API_KEY = process.env.GHL_API_KEY;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID;

export function isGhlConfigured(): boolean {
  return !!(GHL_API_KEY && GHL_LOCATION_ID);
}

export async function sendInviteEmail(
  toEmail: string,
  inviteUrl: string,
  inviterName: string
): Promise<boolean> {
  if (!GHL_API_KEY || !GHL_LOCATION_ID) {
    console.warn("GHL not configured — skipping invite email");
    return false;
  }

  const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
      <h2 style="color: #1e293b; margin-bottom: 8px;">You're invited to Post Creator</h2>
      <p style="color: #64748b; font-size: 15px; line-height: 1.6;">
        ${inviterName} has invited you to join Post Creator — an AI-powered content generation platform.
      </p>
      <div style="margin: 24px 0;">
        <a href="${inviteUrl}" style="display: inline-block; background: #6366f1; color: white; text-decoration: none; padding: 12px 28px; border-radius: 9999px; font-weight: 600; font-size: 15px;">
          Accept Invitation
        </a>
      </div>
      <p style="color: #94a3b8; font-size: 13px;">
        This invite expires in 7 days. If you didn't expect this, you can ignore it.
      </p>
    </div>
  `;

  try {
    const res = await fetch(
      "https://services.leadconnectorhq.com/conversations/messages/email",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GHL_API_KEY}`,
          "Content-Type": "application/json",
          Version: "2021-04-15",
        },
        body: JSON.stringify({
          type: "Email",
          locationId: GHL_LOCATION_ID,
          contactId: toEmail,
          emailTo: toEmail,
          subject: `${inviterName} invited you to Post Creator`,
          html: htmlBody,
        }),
      }
    );

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      console.error("GHL email error:", data);
      return false;
    }
    return true;
  } catch (err) {
    console.error("GHL email failed:", err);
    return false;
  }
}
