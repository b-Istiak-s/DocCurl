export function replaceEditedCurlBlocks(markdown, blocks = []) {
  let blockIndex = 0;

  return String(markdown || "").replace(
    /(^|\n)([ \t]*)(`{3,}|~{3,})[ \t]*curl([^\n]*)\n([\s\S]*?)\n\2\3[ \t]*(?=\n|$)/g,
    (match, leading, indent, marker, suffix) => {
      const block = blocks[blockIndex];
      blockIndex += 1;

      if (!block?.hasStoredEdit) {
        return match;
      }

      return `${leading}${indent}${marker}curl${suffix}\n${block.effectiveCommand}\n${indent}${marker}`;
    },
  );
}
