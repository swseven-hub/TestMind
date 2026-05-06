import ExcelJS from "exceljs";
import {
  getTemplateCaseRow,
  testcaseTemplateHeaders,
  testcaseTemplateInstruction,
  testcaseTemplateSheetName,
} from "@/lib/testcase-template";
import type { GenerateResponse } from "@/types/test-case";

export const runtime = "nodejs";

const columnWidths = [26, 14, 42, 12, 14, 14, 12, 10, 10, 10, 22, 36, 62, 62, 16, 42];

function safeFileName(value: string) {
  return value.replace(/\.pdf$/i, "").replace(/[\\/:*?"<>|]+/g, "-").trim() || "test-cases";
}

function applyCellStyle(cell: ExcelJS.Cell, options: { header?: boolean; instruction?: boolean } = {}) {
  cell.alignment = {
    horizontal: options.instruction ? "left" : "center",
    vertical: "middle",
    wrapText: true,
  };
  cell.font = options.instruction
    ? { name: "宋体", size: 20, bold: true, color: { argb: "FF348FE4" } }
    : { name: "宋体", size: 11, bold: options.header };
  cell.border = {
    top: { style: "thin", color: { argb: "FFB2B2B2" } },
    left: { style: "thin", color: { argb: "FFB2B2B2" } },
    bottom: { style: "thin", color: { argb: "FFB2B2B2" } },
    right: { style: "thin", color: { argb: "FFB2B2B2" } },
  };
  if (options.header) {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFF2F2F2" },
    };
  }
}

function estimateRowHeight(values: Array<string | number | null>) {
  const maxLines = values.reduce<number>((max, value) => Math.max(max, String(value ?? "").split("\n").length), 1);
  return Math.min(180, Math.max(28, 18 + maxLines * 18));
}

function createWorkbook(data: GenerateResponse) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "TestMind";
  workbook.created = new Date();
  workbook.modified = new Date();

  const worksheet = workbook.addWorksheet(testcaseTemplateSheetName, {
    properties: { defaultRowHeight: 16.8 },
    pageSetup: { orientation: "portrait" },
  });

  columnWidths.forEach((width, index) => {
    worksheet.getColumn(index + 1).width = width;
  });

  worksheet.mergeCells(1, 1, 1, testcaseTemplateHeaders.length);
  const instructionCell = worksheet.getCell("A1");
  instructionCell.value = testcaseTemplateInstruction;
  applyCellStyle(instructionCell, { instruction: true });
  worksheet.getRow(1).height = 350;

  const headerRow = worksheet.getRow(2);
  headerRow.values = [...testcaseTemplateHeaders];
  headerRow.height = 22;
  headerRow.eachCell((cell) => applyCellStyle(cell, { header: true }));

  data.cases.slice(0, 5000).forEach((item, index) => {
    const values = getTemplateCaseRow(item).map((value) => (value === "" ? null : value));
    const row = worksheet.getRow(index + 3);
    row.values = values;
    row.height = estimateRowHeight(values);
    for (let columnIndex = 1; columnIndex <= testcaseTemplateHeaders.length; columnIndex += 1) {
      applyCellStyle(row.getCell(columnIndex));
    }
  });

  worksheet.views = [{ state: "frozen", ySplit: 2 }];
  return workbook;
}

export async function POST(request: Request) {
  try {
    const data = (await request.json()) as GenerateResponse;
    if (!Array.isArray(data.cases) || !data.cases.length) {
      return Response.json({ message: "没有可导出的测试用例。" }, { status: 400 });
    }
    if (data.cases.length > 5000) {
      return Response.json({ message: "单次导出最多支持 5000 条测试用例。" }, { status: 400 });
    }

    const workbook = createWorkbook(data);
    const buffer = await workbook.xlsx.writeBuffer();
    const body = buffer instanceof ArrayBuffer ? buffer : new Uint8Array(buffer);
    const fileName = `${safeFileName(data.fileName)}-test-cases.xlsx`;

    return new Response(body, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      },
    });
  } catch (error) {
    console.error(error);
    return Response.json({ message: "Excel 导出失败，请稍后重试。" }, { status: 500 });
  }
}
