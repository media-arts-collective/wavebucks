"""
Holon-fold experiment.

Question being tested: if we apply ONE fold function repeatedly — no
hardcoded depth, no assumption that "message -> thread -> shard" is the
right shape — how many levels of hierarchy does the real krewe mailing
list actually produce before folding stops? Does it land near Beer's 5
(VSM), or somewhere else?

Design, matching the WORM/adjacency-list conversation:
  - Every node (message, or any folded cluster) has the same shape:
    id, level, parent_id (None until folded), entities (weighted fingerprint),
    member_ids (leaves under it).
  - A "fold pass" over the current top layer: compute pairwise weighted
    entity-overlap (rarity-weighted, i.e. IDF over the WHOLE message corpus,
    same idea as before — common posters/words count for little, rare
    mentions count for a lot), connect nodes above a similarity threshold,
    take connected components as new parent nodes.
  - Every fold is logged as an append-only EVENT, never a mutation —
    this is the fasti/Ledger philosophy applied to the fold process itself.
  - Stop when a pass produces zero new folds (nobody left to cluster) or
    a safety cap is hit (bug guard, not a real ceiling).

Entity extraction is a *cheap heuristic* (capitalized-token spans, common-word
filtered), not spaCy/NER. That's a deliberate simplification for a fast first
pass — same caveat flagged in the earlier spaCy experiment: rule-based
extraction lets some noise through (stray caps, list markers) that an LLM
call wouldn't. Fine for testing the FOLD MECHANISM; would want a real NER/LLM
pass before trusting entity quality for production tuning.
"""

import json
import re
from collections import defaultdict, Counter
from datetime import datetime

import numpy as np
from scipy.sparse import lil_matrix, csr_matrix
import networkx as nx

IN_PATH = "/mnt/user-data/uploads/messages.jsonl"
EVENTS_OUT = "/mnt/user-data/outputs/holon_fold_events.jsonl"
SUMMARY_OUT = "/mnt/user-data/outputs/holon_fold_summary.md"

# ---- The one knob (per level, so it's easy to nudge as you tune) ----
# Cosine-similarity threshold required for two nodes to be considered
# "overlapping enough" to fold into a shared parent, at each level.
# Reused for any level beyond what's listed (last value repeats).
FOLD_THRESHOLDS = [0.35, 0.30, 0.30]
MAX_LEVELS = 12  # bug-guard, not a philosophical ceiling
MIN_COMPONENT_SIZE = 2  # a "fold" needs at least 2 children; singletons carry forward untouched

# Common words that show up capitalized for reasons that have nothing to do
# with being an entity (sentence starts, list markers, boilerplate).
STOP_ENTITIES = {
    "hi", "hello", "hey", "thanks", "today", "tomorrow", "tonight", "next",
    "week", "yesterday", "monday", "tuesday", "wednesday", "thursday",
    "friday", "saturday", "sunday", "january", "february", "march", "april",
    "may", "june", "july", "august", "september", "october", "november",
    "december", "please", "here", "the", "this", "that", "if", "we", "i",
    "as", "for", "im", "ok", "yes", "no", "tba", "yall", "y'all",
}


def load_messages(path):
    rows = []
    with open(path) as f:
        for i, line in enumerate(f):
            line = line.strip()
            if not line:
                continue
            rows.append(json.loads(line))
    return rows


def extract_entities(text):
    """Cheap heuristic: runs of capitalized words, 1-3 tokens long."""
    if not text:
        return []
    # Grab capitalized-word runs (allow internal apostrophes/hyphens)
    candidates = re.findall(r"\b[A-Z][a-zA-Z'\-]*(?:\s+[A-Z][a-zA-Z'\-]*){0,2}\b", text)
    out = []
    for c in candidates:
        toks = c.split()
        # drop pure-stopword or single-char junk
        cleaned = [t for t in toks if t.lower() not in STOP_ENTITIES and len(t) > 1]
        if not cleaned:
            continue
        out.append(" ".join(cleaned))
    return out


def build_level0(rows):
    """Level-0 nodes = raw messages, with rarity-weighted entity fingerprints."""
    nodes = []
    entity_doc_freq = Counter()
    per_msg_entities = []

    for r in rows:
        ents = extract_entities(r.get("body", "") or "")
        # also fold the author's handle in as an entity (participant signal)
        author = (r.get("email") or r.get("author") or "").split("@")[0]
        if author:
            ents.append(f"@{author}")
        counted = Counter(ents)
        per_msg_entities.append(counted)
        for e in counted:
            entity_doc_freq[e] += 1

    n_docs = len(rows)
    idf = {e: np.log(n_docs / (1 + df)) for e, df in entity_doc_freq.items()}

    for i, (r, counted) in enumerate(zip(rows, per_msg_entities)):
        nodes.append({
            "id": f"msg-{i}",
            "level": 0,
            "parent_id": None,
            "member_ids": [f"msg-{i}"],
            "raw_ref": r.get("topic_url"),
            "timestamp": r.get("date"),
            "fingerprint": counted,  # Counter, weighted at similarity time via idf
        })
    return nodes, idf


def fingerprint_matrix(nodes, idf, vocab_index):
    n = len(nodes)
    m = lil_matrix((n, len(vocab_index)), dtype=np.float32)
    for i, node in enumerate(nodes):
        for e, count in node["fingerprint"].items():
            j = vocab_index.get(e)
            if j is None:
                continue
            m[i, j] = count * idf.get(e, 0.0)
    m = csr_matrix(m)
    # L2 normalize rows for cosine-via-dot-product
    norms = np.sqrt(m.multiply(m).sum(axis=1)).A1
    norms[norms == 0] = 1.0
    m = m.multiply(1.0 / norms[:, None])
    return csr_matrix(m)


def fold_pass(nodes, idf, threshold, level, event_log, pass_id):
    """One fold: cluster current-level nodes by weighted overlap, emit new
    parent nodes for any cluster of size >= MIN_COMPONENT_SIZE."""
    vocab = sorted({e for node in nodes for e in node["fingerprint"]})
    vocab_index = {e: i for i, e in enumerate(vocab)}
    if not vocab:
        return nodes, []

    mat = fingerprint_matrix(nodes, idf, vocab_index)
    sim = (mat @ mat.T).toarray()
    np.fill_diagonal(sim, 0.0)

    g = nx.Graph()
    g.add_nodes_from(range(len(nodes)))
    ii, jj = np.where(sim >= threshold)
    for a, b in zip(ii, jj):
        if a < b:
            g.add_edge(a, b)

    new_nodes = []
    folded_idx = set()
    new_level = level + 1

    for component in nx.connected_components(g):
        if len(component) < MIN_COMPONENT_SIZE:
            continue
        member_nodes = [nodes[i] for i in component]
        merged_fp = Counter()
        member_ids = []
        for mn in member_nodes:
            merged_fp.update(mn["fingerprint"])
            member_ids.extend(mn["member_ids"])
            folded_idx.add(nodes.index(mn))

        parent_id = f"L{new_level}-{pass_id}-{len(new_nodes)}"
        new_node = {
            "id": parent_id,
            "level": new_level,
            "parent_id": None,
            "member_ids": member_ids,
            "raw_ref": None,
            "timestamp": None,
            "fingerprint": merged_fp,
        }
        new_nodes.append(new_node)

        # append-only fold event, never a mutation of the children
        event_log.append({
            "event": "fold",
            "level": new_level,
            "new_parent_id": parent_id,
            "child_ids": [mn["id"] for mn in member_nodes],
            "child_count": len(member_nodes),
            "pass": pass_id,
            "logged_at": datetime.utcnow().isoformat() + "Z",
        })
        for mn in member_nodes:
            mn["parent_id"] = parent_id

    carried_forward = [nodes[i] for i in range(len(nodes)) if i not in folded_idx]
    return carried_forward, new_nodes


def run():
    rows = load_messages(IN_PATH)
    level0, idf = build_level0(rows)

    all_events = []
    current_layer = level0
    layer_totals = {0: len(current_layer)}
    new_fold_counts = {}
    all_layers = {0: current_layer}

    level = 0
    while level < MAX_LEVELS:
        threshold = FOLD_THRESHOLDS[min(level, len(FOLD_THRESHOLDS) - 1)]
        carried, new_nodes = fold_pass(current_layer, idf, threshold, level, all_events, pass_id=level)
        if not new_nodes:
            break
        next_layer = carried + new_nodes
        level += 1
        new_fold_counts[level] = len(new_nodes)
        layer_totals[level] = len(next_layer)
        all_layers[level] = next_layer
        current_layer = next_layer

    # write append-only event log
    with open(EVENTS_OUT, "w") as f:
        for e in all_events:
            f.write(json.dumps(e) + "\n")

    # sanity check: does emergent level-1 clustering resemble the KNOWN
    # topic_url threads at all, or diverge?
    topic_by_msgid = {n["id"]: n["raw_ref"] for n in level0}
    level1_nodes = all_layers.get(1, [])
    level1_clusters = [n for n in level1_nodes if n["level"] == 1]

    purity_scores = []
    for cluster in level1_clusters:
        topics = [topic_by_msgid.get(mid) for mid in cluster["member_ids"] if mid in topic_by_msgid]
        topics = [t for t in topics if t]
        if not topics:
            continue
        most_common_count = Counter(topics).most_common(1)[0][1]
        purity_scores.append(most_common_count / len(topics))
    avg_purity = float(np.mean(purity_scores)) if purity_scores else None

    with open(SUMMARY_OUT, "w") as f:
        f.write("# Holon-fold experiment: results\n\n")
        f.write(f"Input: {len(rows)} messages from the real krewe archive.\n\n")
        f.write("## Levels that emerged (no depth was hardcoded)\n\n")
        f.write("| Level | New holons formed this pass | Total nodes at this layer (incl. unfolded carry-forwards) |\n")
        f.write("|---|---|---|\n")
        for lvl in sorted(layer_totals):
            newf = new_fold_counts.get(lvl, "-")
            f.write(f"| {lvl} | {newf} | {layer_totals[lvl]} |\n")
        f.write(f"\n**Total levels that formed before folding stopped: {max(layer_totals)}**")
        f.write(f" (VSM has 5; MAX_LEVELS safety cap was {MAX_LEVELS})\n\n")
        f.write("## Sanity check: does emergent level-1 clustering resemble known threads?\n\n")
        f.write(f"{len(level1_clusters)} level-1 holons formed from {len(level0)} messages "
                f"({layer_totals.get(1,0) - len(level1_clusters)} messages never cleared the "
                f"fold threshold and remain unfolded singletons).\n\n")
        if avg_purity is not None:
            f.write(f"Average thread-purity of level-1 holons (fraction of a holon's messages "
                    f"sharing the same real `topic_url`): **{avg_purity:.2f}**\n\n")
            f.write("(1.0 = every emergent holon exactly matches a real Google Groups thread; "
                    "lower = the entity-overlap fold is finding structure that CUTS ACROSS threads, "
                    "e.g. the same recurring situation spread over multiple topic_urls — which is "
                    "the whole point of shards over raw threads, if it's happening on purpose "
                    "rather than by noise.)\n\n")
        f.write("## Knobs actually used\n\n")
        f.write(f"- Fold thresholds per level: {FOLD_THRESHOLDS} (last value repeats past listed levels)\n")
        f.write(f"- Min component size to fold: {MIN_COMPONENT_SIZE}\n")
        f.write(f"- Entity extraction: heuristic capitalized-span matcher, NOT NER/LLM "
                f"(cheap + fast for testing the fold mechanism; noisier than a real API call)\n")

    print(f"Layer totals: {sorted(layer_totals.items())}")
    print(f"New folds per level: {sorted(new_fold_counts.items())}")
    print(f"Avg level-1 purity vs real topic_url threads: {avg_purity}")
    print(f"Events written: {len(all_events)} -> {EVENTS_OUT}")
    print(f"Summary written -> {SUMMARY_OUT}")


if __name__ == "__main__":
    run()
