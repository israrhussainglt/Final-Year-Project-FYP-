"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ScannerStatus =
  | "idle"
  | "starting"
  | "scanning"
  | "found"
  | "no-camera"
  | "denied"
  | "insecure"
  | "error";

/**
 * A hardened wrapper around getUserMedia + jsQR, built to fix the specific
 * ways this silently breaks on real phones (as opposed to a laptop webcam,
 * which forgives all of these):
 *
 * 1. getUserMedia is blocked outright on any origin that isn't https:// or
 *    localhost. Opening the app on a phone via a plain http://LAN-IP dev URL
 *    means the browser refuses before any of our code even runs — this is
 *    detected up front and surfaced as its own "insecure" status with a
 *    clear message, instead of the generic camera error.
 * 2. An exact `facingMode: "environment"` constraint throws on some Android
 *    WebViews / older browsers instead of falling back. We ask for it as an
 *    `ideal` constraint first, then retry with no facingMode at all if that
 *    fails, before finally giving up.
 * 3. Permission-denied vs. no-camera-found vs. every-other-error are treated
 *    identically today, which makes recovery guidance impossible. These are
 *    now distinguished by DOMException.name so the UI can tell someone
 *    "you blocked the camera — re-enable it in your browser's site
 *    settings" instead of a dead-end generic message.
 * 4. `canvas.getContext("2d")` without `willReadFrequently: true` is slow on
 *    mobile GPUs for a getImageData-every-frame loop, which reads as "the
 *    scanner is laggy/broken" even though it's technically working.
 * 5. `video.videoWidth`/`videoHeight` can still be 0 for a frame or two after
 *    `HAVE_ENOUGH_DATA` on some mobile browsers; a 0×0 canvas read silently
 *    produces nothing forever. Guarded against directly.
 * 6. The video element is paused whenever the tab/app is backgrounded
 *    (visibilitychange) and resumed on return, which iOS Safari otherwise
 *    handles inconsistently, sometimes leaving a frozen last frame.
 */
export function useQrScanner(onResult: (raw: string) => void) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const busyRef = useRef(false);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  const [status, setStatus] = useState<ScannerStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const tick = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (
      !video ||
      !canvas ||
      video.readyState !== video.HAVE_ENOUGH_DATA ||
      video.videoWidth === 0 ||
      video.videoHeight === 0
    ) {
      rafRef.current = requestAnimationFrame(tick);
      return;
    }
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      rafRef.current = requestAnimationFrame(tick);
      return;
    }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    const jsQR = (await import("jsqr")).default;
    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: "attemptBoth",
    });

    if (code?.data && !busyRef.current) {
      busyRef.current = true;
      setStatus("found");
      stop();
      onResultRef.current(code.data);
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [stop]);

  const start = useCallback(async () => {
    setStatus("starting");
    setError(null);
    busyRef.current = false;

    if (typeof window !== "undefined" && !window.isSecureContext) {
      setStatus("insecure");
      setError(
        "The camera only works on a secure (https://) connection. Ask for the https link or QR code for this app instead of the plain http address."
      );
      return;
    }
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setStatus("no-camera");
      setError("This browser doesn't support camera access. Try Chrome or Safari, or enter the code manually below.");
      return;
    }

    // Try the rear camera first (as a preference, not a hard requirement),
    // then fall back to whatever camera is available at all.
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setStatus("denied");
        setError("Camera access was blocked. Enable it for this site in your browser settings, then try again.");
        return;
      }
      if (name === "NotFoundError" || name === "OverconstrainedError") {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        } catch {
          setStatus("no-camera");
          setError("No camera was found on this device. You can enter the code manually below instead.");
          return;
        }
      } else {
        setStatus("error");
        setError("Couldn't access the camera. You can enter the code manually below instead.");
        return;
      }
    }

    streamRef.current = stream;
    const video = videoRef.current;
    if (video) {
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        // Autoplay can be rejected if the tab was backgrounded mid-start;
        // visibilitychange handling below will retry play() on return.
      }
    }
    setStatus("scanning");
    tick();
  }, [tick]);

  useEffect(() => {
    start();

    function handleVisibility() {
      if (document.hidden) {
        videoRef.current?.pause();
      } else if (streamRef.current && videoRef.current) {
        videoRef.current.play().catch(() => {});
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retry = useCallback(() => {
    setError(null);
    start();
  }, [start]);

  return { videoRef, canvasRef, status, error, retry, stop };
}
