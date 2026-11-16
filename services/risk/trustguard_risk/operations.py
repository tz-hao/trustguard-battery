from collections import Counter
from datetime import timedelta

import networkx as nx

from .models import OperationRequest


def analyze_operations(request: OperationRequest) -> dict:
    events = request.operations
    if any(e.at > request.as_of for e in events):
        raise ValueError("future operations cannot be evaluated")
    recent = [e for e in events if e.at >= request.as_of - timedelta(minutes=5)]
    counts = Counter(e.actor_msp for e in recent)
    rejected = Counter(e.actor_msp for e in recent if e.rejected)
    reversals = Counter(e.actor_msp for e in recent if e.report_reversal)
    graph = nx.DiGraph()
    fast = Counter()
    rules = []
    for event in recent:
        if not event.rejected and event.target_msp and event.action in {"ApproveRelease","ApprovePolicy","ApproveLifecycleCorrection"}:
            graph.add_edge(event.actor_msp, event.target_msp)
            if event.approval_latency_seconds is not None and event.approval_latency_seconds < 5:
                fast[(event.actor_msp, event.target_msp)] += 1
    for org, count in sorted(counts.items()):
        if count > 60:
            rules.append({"rule": "HIGH_FREQUENCY", "organization": org, "count": count})
        if count >= 5 and rejected[org] * 2 >= count:
            rules.append({"rule": "HIGH_REJECTION_RATIO", "organization": org, "count": rejected[org]})
        if reversals[org] >= 3:
            rules.append({"rule": "REPEATED_REPORT_REVERSAL", "organization": org, "count": reversals[org]})
    for (source, target), count in sorted(fast.items()):
        if count >= 3:
            rules.append({"rule": "FAST_APPROVAL_CLUSTER", "from": source, "to": target, "count": count})
    # Strongly connected components are bounded and avoid exponential cycle enumeration.
    cycles = sorted(sorted(component) for component in nx.strongly_connected_components(graph) if len(component) > 1)
    if cycles:
        rules.append({"rule": "CYCLIC_APPROVAL_RELATIONSHIP", "organizations": cycles})
    return {
        "reviewRequired": bool(rules),
        "triggeredRules": rules,
        "modelVersion": "operation-rules-v1",
        "conclusion": "REQUIRES_REVIEW" if rules else "NO_RULE_TRIGGERED",
    }
