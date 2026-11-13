/** Logo de Cartucho ERP: una «C» de módulos apilados con el punto ámbar del negocio. */
export function BrandMark({ size = 36, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="Cartucho ERP">
      <rect width="100" height="100" rx="22" fill="#5B4BC4" />
      <rect x="20" y="18" width="58" height="17" rx="8.5" fill="#FFFFFF" />
      <rect x="20" y="41.5" width="30" height="17" rx="8.5" fill="#FFFFFF" />
      <rect x="20" y="65" width="58" height="17" rx="8.5" fill="#FFFFFF" />
      <circle cx="68" cy="50" r="8.5" fill="#F5A524" />
    </svg>
  );
}
