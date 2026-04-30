import { useEffect, useRef, useState } from "react";
import { Button } from "./ui/button";

// ---------------------------------------------------------------------------
// iLink API constants
// ---------------------------------------------------------------------------

const ILINK_BASE = "https://ilinkai.weixin.qq.com";

type QrState =
  | "idle"
  | "loading_qr"
  | "showing_qr"
  | "scanned"
  | "confirmed"
  | "bound"
  | "expired"
  | "failed";

interface WechatQrCodePanelProps {
  channelId: string;
  /** Whether the channel already has bound credentials */
  isBound: boolean;
  /** Called when binding is confirmed – persists credentials via runtime */
  onBind: (channelId: string, credentials: { botToken: string; baseUrl: string }) => Promise<void>;
}

// ---------------------------------------------------------------------------
// iLink API helpers (frontend-side, no CORS in Tauri webview)
// ---------------------------------------------------------------------------

function randomUin(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `UIN${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

async function fetchBotQrCode(
  uin: string,
): Promise<{ base64: string; qrcode: string }> {
  const res = await fetch(`${ILINK_BASE}/ilink/bot/get_bot_qrcode?bot_type=3`, {
    method: "GET",
    headers: { "x-wechat-uin": uin },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`iLink get_bot_qrcode HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const raw = (await res.json()) as Record<string, unknown>;

  const base64Raw =
    typeof raw.base64 === "string" ? raw.base64 :
    typeof raw.image === "string" ? raw.image :
    "";
  const qrKey =
    typeof raw.qrcode === "string" ? raw.qrcode :
    typeof raw.qrcode_key === "string" ? raw.qrcode_key :
    typeof raw.key === "string" ? raw.key :
    "";

  if (!base64Raw || !qrKey) {
    throw new Error(
      `iLink 返回格式无法识别。字段: ${Object.keys(raw).join(", ")}`,
    );
  }

  const base64 = base64Raw.replace(/^data:image\/[^;]+;base64,/, "");
  return { base64, qrcode: qrKey };
}

async function fetchQrCodeStatus(
  uin: string,
  qrKey: string,
): Promise<{
  status: string;
  bot_token?: string;
  baseurl?: string;
}> {
  const res = await fetch(
    `${ILINK_BASE}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrKey)}`,
    { method: "GET", headers: { "x-wechat-uin": uin } },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`iLink get_qrcode_status HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const raw = (await res.json()) as Record<string, unknown>;
  return {
    status: typeof raw.status === "string" ? raw.status : "waiting",
    bot_token: typeof raw.bot_token === "string" ? raw.bot_token : undefined,
    baseurl: typeof raw.baseurl === "string" ? raw.baseurl : undefined,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WechatQrCodePanel({
  channelId,
  isBound,
  onBind,
}: WechatQrCodePanelProps) {
  const [state, setState] = useState<QrState>(isBound ? "bound" : "idle");
  const [qrBase64, setQrBase64] = useState("");
  const [error, setError] = useState("");
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const uinRef = useRef(randomUin());
  const qrKeyRef = useRef("");

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, []);

  const startBinding = async () => {
    setState("loading_qr");
    setError("");
    try {
      const result = await fetchBotQrCode(uinRef.current);
      qrKeyRef.current = result.qrcode;
      setQrBase64(result.base64);
      setState("showing_qr");
      startPolling();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("failed");
    }
  };

  const startPolling = () => {
    const poll = async () => {
      if (!mountedRef.current) return;
      try {
        const result = await fetchQrCodeStatus(uinRef.current, qrKeyRef.current);
        if (!mountedRef.current) return;

        if (result.status === "confirmed" && result.bot_token && result.baseurl) {
          setState("confirmed");
          try {
            await onBind(channelId, {
              botToken: result.bot_token,
              baseUrl: result.baseurl,
            });
          } catch {
            // Bind persist failed – still show success, user can retry later
          }
          setTimeout(() => {
            if (mountedRef.current) setState("bound");
          }, 1500);
          return;
        }
        if (result.status === "scanned") {
          setState("scanned");
        }
        if (result.status === "expired" || result.status === "canceled") {
          setState("expired");
          return;
        }

        pollRef.current = setTimeout(poll, 2000);
      } catch (err) {
        setError(`轮询状态失败: ${err instanceof Error ? err.message : String(err)}`);
        setState("failed");
      }
    };

    pollRef.current = setTimeout(poll, 2000);
  };

  const resetToIdle = () => {
    if (pollRef.current) clearTimeout(pollRef.current);
    setState("idle");
    setQrBase64("");
    setError("");
    uinRef.current = randomUin();
    qrKeyRef.current = "";
  };

  // --- Render ---

  if (state === "bound") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl bg-emerald-50 px-4 py-6 ring-1 ring-inset ring-emerald-200">
        <span className="text-sm font-semibold text-emerald-700">
          微信 Bot 已绑定
        </span>
        <span className="text-xs text-emerald-600">
          如需重新绑定，请先删除渠道再重新创建。
        </span>
      </div>
    );
  }

  if (state === "confirmed") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl bg-emerald-50 px-4 py-6 ring-1 ring-inset ring-emerald-200">
        <span className="text-sm font-semibold text-emerald-700">
          扫码确认成功，正在绑定...
        </span>
      </div>
    );
  }

  if (state === "idle" || state === "failed") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl bg-bench-50 px-4 py-6 ring-1 ring-inset ring-bench-200">
        {error && (
          <p className="text-xs text-red-600">{error}</p>
        )}
        <Button
          type="button"
          size="sm"
          className="rounded-xl bg-bench-900 text-white hover:bg-bench-800"
          onClick={startBinding}
        >
          扫码绑定微信 Bot
        </Button>
        <p className="text-xs text-bench-500">
          点击后使用微信扫描二维码完成绑定
        </p>
      </div>
    );
  }

  if (state === "loading_qr") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl bg-bench-50 px-4 py-6 ring-1 ring-inset ring-bench-200">
        <span className="text-sm text-bench-500">正在获取二维码...</span>
      </div>
    );
  }

  // showing_qr or scanned
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl bg-bench-50 px-4 py-6 ring-1 ring-inset ring-bench-200">
      {qrBase64 && (
        <img
          src={`data:image/png;base64,${qrBase64}`}
          alt="WeChat QR Code"
          className="h-52 w-52 rounded-lg"
        />
      )}
      <span className="text-sm font-semibold text-bench-700">
        {state === "scanned" ? "已扫码，请在手机上确认" : "请使用微信扫描二维码"}
      </span>
      {state === "showing_qr" && (
        <span className="text-xs text-bench-400">
          二维码将在数分钟后过期
        </span>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-1 rounded-xl"
        onClick={resetToIdle}
      >
        取消
      </Button>
    </div>
  );
}
