import type { GenerateResponse } from "@/types/test-case";

export async function downloadExcel(data: GenerateResponse) {
  const response = await fetch("/api/export/excel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(payload?.message || "Excel 导出失败，请稍后重试。");
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${data.fileName.replace(/\.pdf$/i, "")}-test-cases.xlsx`;
  anchor.click();
  URL.revokeObjectURL(url);
}
