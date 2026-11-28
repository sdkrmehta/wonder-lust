const { Resend } = require("resend");
const env = require("../config/env");
const AppError = require("../utils/AppError");

function escapeHtml(val) {
	return String(val ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

class EmailService {
	static _getClient() {
		if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
			throw new AppError(
				503,
				"Email verification service is not configured. Configure RESEND_API_KEY and RESEND_FROM_EMAIL.",
			);
		}
		return new Resend(env.RESEND_API_KEY, {
			baseUrl: env.RESEND_BASE_URL || "https://api.resend.com",
		});
	}

	static buildOtpEmailContent({ fullName, otpCode, ttlMinutes = 5 }) {
		const safeName = escapeHtml(fullName || "Traveler");
		const safeOtp = escapeHtml(otpCode);
		const safeMinutes = Math.max(1, Number(ttlMinutes) || 5);

		const subject = "Verify your Wonder-Lust account";
		const html = `
<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background-color:#faf9f5;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a222c;">
	<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px;">
		<tr>
			<td align="center">
				<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:540px;background-color:#ffffff;border:1px solid #e4e2da;border-radius:16px;overflow:hidden;">
					<tr>
						<td style="background-color:#102a43;padding:24px 32px;color:#ffffff;">
							<div style="font-size:20px;font-weight:700;letter-spacing:-0.02em;">Wonder-Lust</div>
							<div style="font-size:13px;color:#d9e2ec;margin-top:4px;">Email Verification</div>
						</td>
					</tr>
					<tr>
						<td style="padding:32px;">
							<h1 style="margin:0 0 12px 0;font-size:22px;color:#102a43;">Verify your email address</h1>
							<p style="margin:0 0 20px 0;font-size:15px;line-height:1.6;color:#4a5568;">
								Hello ${safeName}, use the 6-digit verification code below to activate your Wonder-Lust account.
							</p>
							<div style="background-color:#f0f4f8;border:1px solid #d9e2ec;border-radius:12px;padding:20px;text-align:center;margin:0 0 20px 0;">
								<div style="font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:#486581;font-weight:600;margin-bottom:8px;">One-Time Verification Code</div>
								<div style="font-size:34px;font-weight:700;letter-spacing:0.3em;color:#102a43;font-family:'Courier New',monospace;">${safeOtp}</div>
							</div>
							<p style="margin:0 0 12px 0;font-size:14px;line-height:1.5;color:#4a5568;">
								This code expires in <strong>${safeMinutes} minute${safeMinutes > 1 ? "s" : ""}</strong> and can be used only once.
							</p>
							<p style="margin:0;font-size:13px;line-height:1.5;color:#718096;">
								If you did not create a Wonder-Lust account, you can safely ignore this email.
							</p>
						</td>
					</tr>
					<tr>
						<td style="background-color:#f4f2ec;padding:16px 32px;font-size:12px;color:#5a6577;border-top:1px solid #e4e2da;">
							Sent by Wonder-Lust &bull; Never share your verification code with anyone.
						</td>
					</tr>
				</table>
			</td>
		</tr>
	</table>
</body>
</html>`.trim();

		const text = [
			`Hello ${fullName || "Traveler"},`,
			"",
			"Use the following 6-digit verification code to verify your Wonder-Lust account:",
			"",
			`${otpCode}`,
			"",
			`This code expires in ${safeMinutes} minute${safeMinutes > 1 ? "s" : ""} and can only be used once.`,
			"If you did not request this, you can safely ignore this email.",
		].join("\n");

		return { subject, html, text };
	}

	static async sendEmail({ to, subject, html, text }) {
		const client = this._getClient();
		const recipient = typeof to === "string" ? to.trim().toLowerCase() : "";
		if (!recipient) {
			throw AppError.badRequest("Recipient email address is required");
		}

		let result;
		try {
			result = await client.emails.send({
				from: env.RESEND_FROM_EMAIL,
				to: recipient,
				subject,
				html,
				text,
			});
		} catch (err) {
			throw new AppError(502, `Unable to deliver email via Resend: ${err?.message || "Unknown transport error"}`);
		}

		if (result && result.error) {
			const msg = result.error.message || result.error.name || "Email delivery failed";
			throw new AppError(502, `Email delivery failed: ${msg}`);
		}

		return {
			id: result?.data?.id || null,
		};
	}

	static async sendVerificationOtpEmail({ to, fullName, otpCode, ttlSeconds }) {
		const ttlMinutes = Math.max(1, Math.round((Number(ttlSeconds) || 300) / 60));
		const { subject, html, text } = this.buildOtpEmailContent({
			fullName,
			otpCode,
			ttlMinutes,
		});
		return await this.sendEmail({
			to,
			subject,
			html,
			text,
		});
	}
}

module.exports = EmailService;
