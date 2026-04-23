/** 与对话页 `listen-orb-wrap` / `listen-orb` / `listen-orb-core` 同源，仅加 `--mark` 尺寸修饰符。 */
export function SayloMark() {
  return (
    <div className="saylo-mark" aria-hidden="true">
      <div className="listen-orb-wrap listen-orb-wrap--mark">
        <div className="listen-orb listen-orb--mark">
          <span className="listen-orb-core listen-orb-core--mark" />
        </div>
      </div>
    </div>
  );
}
