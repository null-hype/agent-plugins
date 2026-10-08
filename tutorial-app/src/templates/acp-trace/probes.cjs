// CIT-330: a reply's probes may form a tree, where a probe with `children`
// rests on them. Acceptance indexes count the whole tree in preorder, so a
// flat list (no children) keeps the indexes it always had. These run in both
// pages (injected below) and in activity(), so all three read an index alike.
function probeTree(probes) {
  const nodes = [];
  const visit = (probe, depth, parent) => {
    const index = nodes.length;
    nodes.push({ probe, depth, parent, children: [] });
    if (parent >= 0) nodes[parent].children.push(index);
    (probe.children || []).forEach((child) => visit(child, depth + 1, index));
  };
  (probes || []).forEach((probe) => visit(probe, 0, -1));
  return nodes;
}

// An accepted probe that rests on others reads as a Markdown heading at its depth.
function probeLine(node) {
  return node.children.length ? '#'.repeat(node.depth + 1) + ' ' + node.probe.question : node.probe.question;
}

// A probe's finding. Once every probe it rests on is accepted, the finding
// that combines them (`unfolded`) replaces it, if it has one.
function probeDiagnostic(nodes, index, accepted) {
  const node = nodes[index];
  const unfolded = node.probe.unfolded && node.children.every((child) => accepted.includes(child));
  return (unfolded ? node.probe.unfolded : node.probe.diagnostic) || null;
}

// What can be offered next: probes not yet accepted whose parent has been.
function probeOffers(nodes, accepted) {
  return nodes.map((_, index) => index).filter((index) => !accepted.includes(index) &&
    (nodes[index].parent < 0 || accepted.includes(nodes[index].parent)));
}

// CIT-357: a review may come in several replies, one per lesson, all answering
// the same prompt. Acceptance indexes count the turn's probes across its replies
// in order; a reply's own probes start at the count before it.
function probeOffset(frames, at) {
  let offset = 0;
  for (let index = at - 1; index >= 0 && frames[index].actor !== 'client'; index -= 1) {
    const envelope = frames[index].envelope || {};
    const meta = (envelope.result && envelope.result._meta) || {};
    offset += probeTree(meta.probes).length;
  }
  return offset;
}

// The accepted indexes that fall in one reply's probes, as that reply counts them.
function acceptedIn(accepted, offset, count) {
  return accepted.filter((index) => index >= offset && index < offset + count).map((index) => index - offset);
}

// What a review's stored choices become when a lesson that shows only its first
// `visible` probes reports `shown` (CIT-362). A continued review's lessons each
// show a prefix of its probes, so the lesson decides those and keeps the rest:
// revisiting an earlier lesson, solved or not, leaves a later lesson's accepts
// alone. Removing an accepted line, in a lesson that shows it, still un-accepts it.
function retainedOrder(stored, shown, visible) {
  const kept = shown.filter((index) => index < visible);
  return kept.concat(stored.filter((index) => index >= visible && !kept.includes(index)));
}

module.exports = { probeTree, probeLine, probeDiagnostic, probeOffers, probeOffset, acceptedIn, retainedOrder };
