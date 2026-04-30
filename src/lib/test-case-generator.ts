import type { GenerateResponse, TestCase, TestCategory } from "@/types/test-case";

const moduleCasePlan: TestCategory[] = ["功能", "功能", "功能", "边界", "边界", "异常", "异常", "权限", "性能"];

function cleanText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function sentenceCandidates(text: string) {
  return text
    .split(/(?<=[。！？.!?；;])\s+|[\n\r]+|(?:\d+\.|[一二三四五六七八九十]+、)/)
    .map(cleanText)
    .filter((item) => item.length >= 12 && !/^--\s*\d+\s+of\s+\d+\s*--$/i.test(item))
    .slice(0, 80);
}

function inferModule(line: string, index: number) {
  const candidates = line.match(/(?:模块|页面|功能|流程|入口|菜单|服务|接口|表单|报表|配置|规则|角色|对象|任务)[:：]?\s*([\u4e00-\u9fa5A-Za-z0-9_-]{2,18})/);
  if (candidates?.[1]) return candidates[1];
  const shortText = line.replace(/[，,。；;：:]/g, " ").split(/\s+/).find((part) => part.length >= 2 && part.length <= 12);
  return shortText ?? `需求点 ${index + 1}`;
}

function priorityFor(category: TestCategory, index: number) {
  if (category === "功能" || category === "权限") return index % 3 === 0 ? "P0" : "P1";
  if (category === "性能") return index % 2 === 0 ? "P1" : "P2";
  return index % 4 === 0 ? "P1" : "P2";
}

function titleFor(category: TestCategory, moduleName: string, line: string) {
  const snippet = line.length > 32 ? `${line.slice(0, 32)}...` : line;
  const templates: Record<TestCategory, string> = {
    功能: `${moduleName}核心流程：${snippet}`,
    边界: `${moduleName}边界输入：${snippet}`,
    异常: `${moduleName}异常处理：${snippet}`,
    权限: `${moduleName}权限控制：${snippet}`,
    性能: `${moduleName}性能验证：${snippet}`,
  };
  return templates[category];
}

function stepsFor(category: TestCategory, line: string) {
  const base = cleanText(line);
  const templates: Record<TestCategory, string[]> = {
    功能: ["使用满足前置条件的测试身份或测试数据进入对应功能", `按 PRD 描述执行：${base}`, "提交、保存或触发对应操作并检查结果"],
    边界: ["准备最小值、最大值、空值和重复值等数据", `在对应字段或流程中覆盖：${base}`, "分别提交并记录系统反馈"],
    异常: ["构造无效数据、服务失败或中断场景", `触发 PRD 涉及流程：${base}`, "观察错误提示、回滚状态和日志记录"],
    权限: ["分别使用无权限、普通权限和高权限身份访问", `尝试执行受控操作：${base}`, "核对可见入口、接口返回和审计记录"],
    性能: ["准备接近真实业务量的数据和并发用户", `对关键路径执行压力请求：${base}`, "统计响应时间、成功率和资源占用"],
  };
  return templates[category];
}

function expectedFor(category: TestCategory) {
  const expectations: Record<TestCategory, string> = {
    功能: "结果与 PRD 一致，页面状态、后端数据和提示信息正确。",
    边界: "边界值被正确接受或拦截，校验提示清晰且不会产生脏数据。",
    异常: "系统给出可理解的错误反馈，关键数据不丢失，流程可恢复。",
    权限: "仅授权角色可访问或操作，未授权请求被拒绝并保留必要记录。",
    性能: "核心指标达到约定阈值，失败率和资源占用处于可接受范围。",
  };
  return expectations[category];
}

export function generateFallbackCases(text: string, fileName: string): GenerateResponse {
  const candidates = sentenceCandidates(text);
  const seed = candidates.length > 0 ? candidates : ["PRD 未提取到足够文本，请补充更清晰的需求描述。"];
  const cases: TestCase[] = [];
  const moduleGroups = new Map<string, string[]>();

  seed.forEach((line, index) => {
    const moduleName = inferModule(line, index);
    moduleGroups.set(moduleName, [...(moduleGroups.get(moduleName) ?? []), line]);
  });

  const modules = [...moduleGroups.entries()].slice(0, 12);
  let caseIndex = 1;

  for (const [moduleName, lines] of modules) {
    for (let i = 0; i < moduleCasePlan.length; i += 1) {
      const category = moduleCasePlan[i];
      const line = lines[(i * 2) % lines.length];

      cases.push({
        id: `TC-${String(caseIndex).padStart(3, "0")}`,
        category,
        title: titleFor(category, moduleName, line),
        priority: priorityFor(category, i),
        module: moduleName,
        preconditions: `${moduleName}模块已部署，测试身份、测试数据和依赖服务可用。`,
        steps: stepsFor(category, line),
        expectedResult: expectedFor(category),
      });

      caseIndex += 1;
    }
  }

  return {
    source: "fallback",
    fileName,
    summary: `已基于 PRD 文本识别 ${modules.length} 个功能模块、${Math.min(seed.length, 80)} 个需求片段，生成 ${cases.length} 条测试用例。`,
    cases,
    warnings: ["未检测到可用的模型 API Key，当前结果由本地规则生成；配置密钥后会启用大模型生成。"],
  };
}
