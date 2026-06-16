export function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

export function truncateToLimit(text: string, maxTokens: number = 6000): string {
    const maxChars = maxTokens * 4;
    if (text.length > maxChars) {
        return text.substring(0, maxChars) + "\n\n... [Content truncated due to context window limits]";
    }
    return text;
}
