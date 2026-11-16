#!/usr/bin/env python3
"""Pre-contest one-click readiness check & 9-minute Sichuan Skills Competition walkthrough info."""
import json
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WEB_URL = "http://127.0.0.1:3100"


def check_http_get(path: str):
    with urllib.request.urlopen(f"{WEB_URL}{path}", timeout=10) as resp:
        return resp.status, resp.read().decode("utf-8")


def main():
    print("== 1. 检查并按需拉起 Fabric 容器与业务服务 ==")
    subprocess.run([sys.executable, str(ROOT / "infrastructure/scripts/business_network.py"), "resume"], check=False)
    subprocess.run([sys.executable, str(ROOT / "infrastructure/scripts/business_services.py"), "start"], check=False)

    print("\n== 2. 验证 11 个前端路由可达性 ==")
    routes = ["/", "/identity", "/inspections", "/trace", "/approvals", "/transfers", "/risk", "/policies", "/lab", "/audit", "/organizations"]
    for route in routes:
        status, _ = check_http_get(route)
        if status != 200:
            raise RuntimeError(f"Route {route} returned HTTP {status}")
        print(f"  [OK] {route} -> HTTP {status}")

    print("\n== 3. 提取实时演示样本（无数据删改） ==")
    _, dash_raw = check_http_get("/api/bff/dashboard")
    _, assets_raw = check_http_get("/api/bff/assets")
    _, batches_raw = check_http_get("/api/bff/batches")
    dash = json.loads(dash_raw)
    assets = json.loads(assets_raw).get("assets", [])
    batches = json.loads(batches_raw).get("batches", [])

    standalone = next((a for a in assets if a["state"] == "REGISTERED" and not a.get("parentId")), None)
    in_use = next((a for a in assets if a["type"] == "PACK" and a["state"] == "IN_USE"), None)
    scrapped = next((a for a in assets if a["type"] == "PACK" and a.get("scrapped")), None)
    rejected_batch = next((b for b in batches if b.get("rejectedCount", 0) > 0), batches[0] if batches else None)

    print(f"  Fabric 区块高度: #{dash['summary']['ledgerHeight']} | PG 索引高度: #{dash['summary']['indexedBlock']} | 策略版本: v{dash['summary']['activePolicyVersion']}")
    print(f"  资产总量: {dash['summary']['totalAssets']} (电芯 {dash['summary']['cells']}, 模组 {dash['summary']['modules']}, PACK {dash['summary']['packs']})")
    if standalone:
        print(f"  [样例 1 · 未装配电芯]   code={standalone['code']}  id={standalone['id']}")
    if in_use:
        print(f"  [样例 2 · 在用电池包]   code={in_use['code']}  id={in_use['id']}")
    if scrapped:
        print(f"  [样例 3 · 已报废确认]   code={scrapped['code']}  id={scrapped['id']}")
    if rejected_batch:
        print(f"  [样例 4 · 异常电芯批次] batchId={rejected_batch['id']}")

    print("\n== 4. 9 分钟现场演示快速路线图 ==")
    print("  1) /organizations  -> 展示 4 组织拓扑与 28 组服务端白名单 mTLS 身份（零前端私钥）")
    print("  2) /identity       -> 展示 24 位 GB/T 34014 编码 7 段标尺解析与 3 种电池生命周期对比")
    print("  3) /inspections    -> 展示 CSV 签名量测导入、IsolationForest 筛选与抽屉 AEAD 解密/撤权")
    print("  4) /trace          -> 选择异常电芯批次展示正向影响树与 PACK 受影响清单")
    print("  5) /risk & /policies -> 展示 AI 质量/NetworkX 图风控与弱化策略隔离 Go 沙箱阻断")
    print("  6) /lab & /audit   -> 运行 A1-A8 实网攻防确认零篡改，前往 /audit 展示取证三元联动")
    print("\nREADY FOR CONTEST DEMO.")


if __name__ == "__main__":
    main()
