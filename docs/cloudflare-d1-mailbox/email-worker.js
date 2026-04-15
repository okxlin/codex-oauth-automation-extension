function log(msg) {
  console.log(`[邮件系统] ${msg}`);
}

function logError(msg) {
  console.error(`[错误] ${msg}`);
}

function canonicalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function parseRetentionDays(value, fallback) {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function decodeQuotedPrintable(input) {
  return String(input || "")
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-F]{2})/gi, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );
}

function decodeBase64Utf8(str) {
  try {
    const clean = String(str || "").replace(/\s+/g, "");
    const binary = atob(clean);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return String(str || "");
  }
}

function decodeMimeBody(content, headers) {
  const lower = String(headers || "").toLowerCase();

  if (lower.includes("content-transfer-encoding: base64")) {
    return decodeBase64Utf8(content);
  }

  if (lower.includes("content-transfer-encoding: quoted-printable")) {
    return decodeQuotedPrintable(content);
  }

  return String(content || "");
}

function extractHeader(raw, name) {
  const regex = new RegExp(
    `^${name}:([\\s\\S]*?)(\\r?\\n[^\\S\\r\\n]+[\\s\\S]*?)*$`,
    "im"
  );
  const match = raw.match(regex);
  if (!match) return "";

  return match[0]
    .replace(new RegExp(`^${name}:`, "i"), "")
    .replace(/\r?\n[ \t]+/g, " ")
    .trim();
}

function getBoundary(raw) {
  const match = raw.match(/boundary="?([^";\r\n]+)"?/i);
  return match ? match[1] : "";
}

function splitMimeParts(raw, boundary) {
  if (!boundary) return [];

  const marker = `--${boundary}`;
  const closingMarker = `--${boundary}--`;
  const lines = raw.split(/\r?\n/);

  const parts = [];
  let collecting = false;
  let current = [];

  for (const line of lines) {
    if (line === marker) {
      if (current.length > 0) {
        parts.push(current.join("\n"));
        current = [];
      }
      collecting = true;
      continue;
    }

    if (line === closingMarker) {
      if (current.length > 0) {
        parts.push(current.join("\n"));
      }
      break;
    }

    if (collecting) {
      current.push(line);
    }
  }

  return parts;
}

function parsePart(part) {
  const separatorMatch = part.match(/\r?\n\r?\n/);
  if (!separatorMatch) {
    return { headers: part, body: "" };
  }

  const idx = separatorMatch.index ?? 0;
  const sepLen = separatorMatch[0].length;

  return {
    headers: part.slice(0, idx),
    body: part.slice(idx + sepLen),
  };
}

function extractMimeContent(raw, contentType) {
  const boundary = getBoundary(raw);
  if (!boundary) return "";

  const parts = splitMimeParts(raw, boundary);

  for (const part of parts) {
    const { headers, body } = parsePart(part);
    const lowerHeaders = headers.toLowerCase();

    if (lowerHeaders.includes(`content-type: ${contentType}`)) {
      return decodeMimeBody(body, headers).trim();
    }

    if (lowerHeaders.includes("multipart/")) {
      const nested = `${headers}\n\n${body}`;
      const nestedResult = extractMimeContent(nested, contentType);
      if (nestedResult) return nestedResult;
    }
  }

  return "";
}

function extractBestHtml(raw) {
  return extractMimeContent(raw, "text/html");
}

function extractBestText(raw) {
  return extractMimeContent(raw, "text/plain");
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function otpRegex() {
  return /(?<![a-zA-Z0-9#=\.])(\d{6})(?![a-zA-Z0-9\.])/g;
}

function extractCode(text) {
  const source = String(text || "");
  const excludedCodes = ["177010", "000000"];

  const strongPatterns = [
    /verification code[^\d]{0,20}(\d{6})/i,
    /code[^\d]{0,20}(\d{6})/i,
    /otp[^\d]{0,20}(\d{6})/i,
    /one[-\s]?time[^\d]{0,20}(\d{6})/i,
    /\b(\d{6})\b(?=.*(login|sign in|verify))/i,
  ];

  for (const pattern of strongPatterns) {
    const match = source.match(pattern);
    if (match?.[1] && !excludedCodes.includes(match[1])) {
      return match[1];
    }
  }

  const hits = [];
  let match;
  const regex = otpRegex();

  while ((match = regex.exec(source)) !== null) {
    hits.push(match[1]);
  }

  for (const candidate of hits) {
    if (!excludedCodes.includes(candidate)) {
      return candidate;
    }
  }

  return "";
}

async function cleanupExpiredData(env) {
  const emailDays = parseRetentionDays(env.EMAIL_RETENTION_DAYS, 30);
  const codeDays = parseRetentionDays(env.CODE_RETENTION_DAYS, 2);

  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM emails
       WHERE datetime(created_at) < datetime('now', '-' || ? || ' day')`
    ).bind(emailDays),
    env.DB.prepare(
      `DELETE FROM codes
       WHERE datetime(created_at) < datetime('now', '-' || ? || ' day')`
    ).bind(codeDays),
  ]);

  log(`定时清理完成: emails>${emailDays}天, codes>${codeDays}天`);
}

export default {
  async email(message, env, ctx) {
    try {
      const to = canonicalizeEmail(message.to);
      if (!to) return;

      const rawEmail = await new Response(message.raw).text();
      const subject = extractHeader(rawEmail, "Subject");

      const html = extractBestHtml(rawEmail);
      const text = extractBestText(rawEmail);
      const fallbackText = stripHtml(html);

      const body = html || text || fallbackText || rawEmail;
      const code = extractCode(text || fallbackText || rawEmail);
      const isOtp = !!code;

      const lowerSource = `${subject}\n${text}\n${fallbackText}\n${rawEmail}`.toLowerCase();
      const stage = lowerSource.includes("login") ? "login" : "register";
      const now = new Date().toISOString();

      log(`收到邮件 → ${to}`);

      if (isOtp) {
        log(`OTP → ${code}`);

        try {
          await env.DB.prepare(
            `INSERT INTO codes (email, code, stage, source, subject, created_at, received_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            to,
            code,
            stage,
            "email_worker_online_mime_v1",
            subject,
            now,
            now
          ).run();
        } catch (err) {
          logError(`codes写入失败: ${err instanceof Error ? err.message : String(err)}`);
        }

        await env.DB.prepare(
          `INSERT INTO emails (email, subject, body, has_code, code, stage, source, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          to,
          subject,
          body,
          1,
          code,
          stage,
          "email_worker_online_mime_v1",
          now
        ).run();

        log("OTP已存储（body中为HTML或完整正文）");
      } else {
        await env.DB.prepare(
          `INSERT INTO emails (email, subject, body, has_code, code, stage, source, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          to,
          subject,
          body,
          0,
          "",
          stage,
          "email_worker_online_mime_v1",
          now
        ).run();

        log("普通邮件已存储（body中为HTML或完整正文）");
      }

      ctx.waitUntil(cleanupExpiredData(env));
    } catch (error) {
      logError(error instanceof Error ? error.message : String(error));
    }
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(cleanupExpiredData(env));
  },
};
