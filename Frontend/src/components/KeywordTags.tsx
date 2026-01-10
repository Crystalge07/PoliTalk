interface KeywordTagsProps {
  keywords: string[];
}

export const KeywordTags = ({ keywords }: KeywordTagsProps) => {
  if (keywords.length === 0) return null;

  return (
    <div className="space-y-2 animate-fade-in">
      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
        Key Indicators
      </p>
      <div className="flex flex-wrap gap-1.5">
        {keywords.slice(0, 5).map((keyword, index) => (
          <span
            key={index}
            className="px-2 py-0.5 text-xs bg-secondary text-secondary-foreground"
          >
            {keyword}
          </span>
        ))}
      </div>
    </div>
  );
};
