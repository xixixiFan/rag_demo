/**
 * 简易版递归字符切片器
 */
export function recursiveCharacterSplitter(text, maxChunkSize = 400, overlap = 40) {
    const separators = ["\n\n", "\n", "。", "，", " "];
    
    function splitRecursive(content, currentSeparatorIdx) {
        if (content.length <= maxChunkSize) return [content];
        
        if (currentSeparatorIdx >= separators.length) {
            // 所有分隔符都试过了，还是超长，只能强行按字数截断（类似固定大小切片）
            return chunkStringByLength(content, maxChunkSize, overlap);
        }

        const sep = separators[currentSeparatorIdx];
        const parts = content.split(sep);
        let chunks = [];
        let currentChunk = "";

        for (const part of parts) {
            // 恢复被 split 删掉的分隔符
            const partWithSep = currentChunk ? sep + part : part;
            
            if ((currentChunk + partWithSep).length <= maxChunkSize) {
                currentChunk += partWithSep;
            } else {
                if (currentChunk) chunks.push(currentChunk.trim());
                // 如果单条子片段递归进去还超长，继续交给下一个更细的分隔符处理
                if (part.length > maxChunkSize) {
                    chunks.push(...splitRecursive(part, currentSeparatorIdx + 1));
                    currentChunk = "";
                } else {
                    currentChunk = part;
                }
            }
        }
        if (currentChunk) chunks.push(currentChunk.trim());
        return chunks;
    }

    return splitRecursive(text, 0);
}

// 辅助函数：兜底的硬切
function chunkStringByLength(str, size, overlap) {
    const res = [];
    let i = 0;
    while (i < str.length) {
        res.push(str.slice(i, i + size));
        i += (size - overlap);
    }
    return res;
}