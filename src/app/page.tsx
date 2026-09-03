import { DiscoveryConsole } from "@/components/discovery-console";

export default function Home() {
  return (
    <main className="shell">
      <header className="hero">
        <p className="eyebrow">FIXUP · CREATOR DISCOVERY</p>
        <h1>일본 크리에이터 후보 찾기</h1>
        <p className="subcopy">많이 찾고, 중복은 막고, 확인 가능한 근거만 남깁니다.</p>
      </header>
      <DiscoveryConsole />
    </main>
  );
}
