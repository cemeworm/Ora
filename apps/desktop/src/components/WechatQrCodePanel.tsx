import { useEffect, useRef, useState } from "react";
import { Button } from "./ui/button";
import type { RuntimeClient } from "../lib/runtimeClient";

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
  runtimeClient: RuntimeClient;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WechatQrCodePanel({
  channelId,
  isBound,
  onBind,
  runtimeClient,
}: WechatQrCodePanelProps) {
  const [state, setState] = useState<QrState>(isBound ? "bound" : "idle");
  const [qrImageSrc, setQrImageSrc] = useState("");
  const [qrPageSrc, setQrPageSrc] = useState("");
  const [qrImageMeta, setQrImageMeta] = useState<{ mimeType?: string; length: number; prefix: string } | undefined>();
  const [error, setError] = useState("");
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

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
      const result = await runtimeClient.wechatRequestQrCode(channelId);
      if (!result?.base64 && !result?.imageSrc && !result?.pageSrc) {
        throw new Error(`runtime 返回了无效的 QR 码响应: ${JSON.stringify(result)}`);
      }
      const imageSrc = result.imageSrc ?? (result.base64 ? `data:${result.mimeType ?? "image/png"};base64,${result.base64}` : "");
      setQrImageSrc(imageSrc);
      setQrPageSrc(result.pageSrc ?? "");
      setQrImageMeta({
        mimeType: result.mimeType,
        length: imageSrc.length,
        prefix: imageSrc.slice(0, 48),
      });
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
        const result = await runtimeClient.wechatPollQrCodeStatus(channelId);
        if (!mountedRef.current) return;

        if (result.status === "confirmed" && result.botToken && result.baseUrl) {
          setState("confirmed");
          try {
            await onBind(channelId, {
              botToken: result.botToken,
              baseUrl: result.baseUrl,
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
    setQrImageSrc("");
    setQrPageSrc("");
    setQrImageMeta(undefined);
    setError("");
  };

  const openQrPage = async () => {
    if (!qrPageSrc) return;
    try {
      await runtimeClient.openExternalUrl(qrPageSrc);
    } catch (err) {
      setError(`无法打开二维码页面: ${err instanceof Error ? err.message : String(err)}`);
    }
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
      {qrPageSrc ? (
        <div className="flex h-52 w-52 flex-col items-center justify-center gap-3 rounded-lg bg-white p-4 text-center ring-1 ring-inset ring-bench-200">
          <p className="text-sm font-semibold text-bench-800">
            微信返回的是二维码页面
          </p>
          <p className="text-xs leading-5 text-bench-500">
            该页面无法在 Ora 内直接展示，请在浏览器中打开后扫码。
          </p>
          <Button
            type="button"
            size="sm"
            className="rounded-xl bg-bench-900 text-white hover:bg-bench-800"
            onClick={openQrPage}
          >
            打开二维码页面
          </Button>
        </div>
      ) : qrImageSrc ? (
        <img
          src={qrImageSrc}
          alt="WeChat QR Code"
          className="h-52 w-52 rounded-lg"
          onError={() => {
            setError(
              `二维码图片无法解码: ${qrImageMeta?.mimeType ?? "unknown"}, length=${qrImageMeta?.length ?? 0}, prefix=${qrImageMeta?.prefix ?? ""}`,
            );
          }}
        />
      ) : null}
      {error && (
        <p className="max-w-64 break-all text-center text-xs text-red-600">{error}</p>
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
