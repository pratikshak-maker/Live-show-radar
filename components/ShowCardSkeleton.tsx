export function ShowCardSkeleton() {
  return (
    <div
      aria-hidden
      className="grid grid-cols-[1fr_132px] overflow-hidden rounded-[14px] border border-line bg-surface max-[520px]:grid-cols-[1fr_108px]"
    >
      <div className="flex gap-3 p-4">
        <div className="skeleton h-14 w-14 shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="skeleton h-5 w-2/3" />
          <div className="skeleton h-4 w-1/2" />
          <div className="skeleton h-4 w-1/3" />
          <div className="skeleton mt-3 h-10 w-32" />
        </div>
      </div>
      <div className="border-l-2 border-dashed border-line p-4">
        <div className="skeleton mx-auto h-4 w-14" />
        <div className="skeleton mx-auto mt-3 h-7 w-16" />
      </div>
    </div>
  );
}
