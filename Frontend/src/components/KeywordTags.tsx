interface KeywordTagsProps {
  keywords: string[];
}

export const KeywordTags = ({ keywords }: KeywordTagsProps) => {
  if (keywords.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {keywords.map((keyword) => (
        <span key={keyword} className="bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
          {keyword}
        </span>
      ))}
    </div>
  );
};
