import qrcode from "qrcode-generator";
import { useMemo } from "react";

export function Qr({ value, size = 200 }: { value: string; size?: number }) {
  const src = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();
    return qr.createDataURL(Math.max(2, Math.floor(size / qr.getModuleCount())), 8);
  }, [value, size]);
  return <img className="qr" src={src} width={size} height={size} alt="QR code" />;
}
