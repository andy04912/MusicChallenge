import {
  PlayIcon,
  LightningIcon,
  InfinityIcon,
  UsersThreeIcon,
  ConfettiIcon,
  XIcon,
  ArrowRightIcon,
} from "@phosphor-icons/react";
const pages = [
  {
    icon: PlayIcon,
    tag: "01 / LISTEN",
    title: "一秒，也許就夠了。",
    text: "按下播放，聽一次已解鎖的片段。想再聽就再按一次，重播不扣分。",
    detail: "輸入歌名，或搜尋歌手挑選歌曲，再送出答案。",
  },
  {
    icon: LightningIcon,
    tag: "02 / SCORE",
    title: "少聽一點，多拿一點。",
    text: "答錯或按「延長片段」，就會解鎖更長的片段，並降低本題可得分數。",
    detail: "完整片段仍答錯，或直接揭曉，本題為 0 分。",
  },
  {
    icon: InfinityIcon,
    tag: "03 / CHALLENGE",
    title: "五首熱身，還是一路挑戰？",
    text: "經典挑戰玩五首；無限挑戰可以一直下一首，想休息時按結束，保存這次成績。",
    detail: "排行榜分開記錄兩種模式。華語與 K-POP 各自出題，不混搭。",
  },
  {
    icon: UsersThreeIcon,
    tag: "04 / DUEL",
    title: "同一首歌，誰更快聽懂？",
    text: "開房設定模式，分享邀請連結給朋友。雙方各自作答，都完成後才一起揭曉。",
    detail:
      "先看本題得分，再累加總分。兩人都按「準備」才進下一首；按「結束」可保留已完成作答的得分，雙方查看結算。",
  },
  {
    icon: ConfettiIcon,
    tag: "05 / PARTY",
    title: "一台放歌，全場搶答。",
    text: "主機開派對，大家掃 QR Code 加入。完整試聽由主機播放，手機輸入歌名，猜錯可再猜，也能放棄這首。",
    detail:
      "每首依答對順序得 1,000、900、800…最低 100 分，放棄 0 分。最多 50 人；主機結束後依累積分數頒獎，並可分享戰果。",
  },
];
export default function HowToPlay({ dialog, step, setStep }) {
  const item = pages[step],
    Icon = item.icon;
  return (
    <dialog
      ref={dialog}
      className="how-dialog"
      id="how-dialog"
      aria-labelledby="how-title"
      onClose={() => setStep(0)}
    >
      <div className="how-top">
        <span>{item.tag}</span>
        <button
          type="button"
          className="text-button"
          aria-label="關閉說明"
          onClick={() => dialog.current.close()}
        >
          <XIcon />
        </button>
      </div>
      <div key={step} className="how-body">
        <div className="how-symbol">
          <Icon weight="duotone" />
        </div>
        <h2 id="how-title">{item.title}</h2>
        <p>{item.text}</p>
        {step === 1 && (
          <div className="how-tiers">
            {[
              ["1秒", 1000],
              ["6秒", 800],
              ["12秒", 600],
              ["18秒", 400],
              ["24秒", 200],
              ["完整", 100],
            ].map(([s, p]) => (
              <div key={p}>
                <span>{s}</span>
                <strong>{p}</strong>
              </div>
            ))}
          </div>
        )}
        <p className="how-detail">{item.detail}</p>
      </div>
      <div className="how-bottom">
        <div className="how-dots" aria-label="說明頁碼">
          {pages.map((p, i) => (
            <button
              type="button"
              key={p.tag}
              onClick={() => setStep(i)}
              aria-label={`第 ${i + 1} 頁說明`}
              aria-current={i === step ? "step" : undefined}
            >
              <span />
            </button>
          ))}
        </div>
        <button
          type="button"
          className="primary"
          onClick={() =>
            step === pages.length - 1
              ? dialog.current.close()
              : setStep(step + 1)
          }
        >
          {step === pages.length - 1 ? "開始挑戰" : "下一步"}
          <ArrowRightIcon />
        </button>
      </div>
    </dialog>
  );
}
