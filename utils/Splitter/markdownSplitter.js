/**
 * Markdown 语义切片器
 * @param {string} text 原始 Markdown 文本
 * @param {number} maxChunkSize 每个分块的最大字符数
 * @param {number} overlap 重叠区字符数
 */
export function advancedMarkdownSplitter(text, maxChunkSize = 600, overlap = 60) {
    // 1. 按照 Markdown 的标题符号进行粗切，保留标题本身
    // 正则捕获：匹配以 #, ##, ### 开头的行
    const regex = /(?=\n#{1,4} )/;
    const sections = text.split(regex);
    
    const chunks = [];
    
    for (const section of sections) {
        if (section.trim().length === 0) continue;

        // 如果这个章节整体很短，直接当成一个切片
        if (section.length <= maxChunkSize) {
            chunks.push(section.trim());
        } else {
            // 如果章节过长（比如大标题下有巨多字），引入“递归段落切片”
            const paragraphs = section.split('\n\n');
            let currentChunk = "";

            for (const para of paragraphs) {
                // 如果单段拼进去没超标
                if ((currentChunk + para).length <= maxChunkSize) {
                    currentChunk += (currentChunk ? "\n\n" : "") + para;
                } else {
                    // 超标了，吐出当前分块
                    if (currentChunk) chunks.push(currentChunk.trim());
                    
                    // 带着 overlap 开启新分块
                    // 实际工程中，这里会把当前章节的“父标题”强行拼在新分块头部，防止丢失上下文
                    currentChunk = para; 
                }
            }
            if (currentChunk) chunks.push(currentChunk.trim());
        }
    }
    
    return chunks;
}