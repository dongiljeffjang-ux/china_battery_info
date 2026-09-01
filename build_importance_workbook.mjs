import fs from 'node:fs/promises';
import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';

const outputDir = 'C:/Users/POSCOFUTUREM/Documents/china_info/outputs/importance-labeling';
const outputPath = `${outputDir}/china-battery-lens-importance-labeling.xlsx`;

const sources = {
  catl: 'https://www.catl.com/en/news/6773.html',
  catlCn: 'https://www.catl.com/news/9654.html',
  catlYutong: 'https://www.catl.com/en/news/6958.html',
  catlAnnual: 'https://static.cninfo.com.cn/finalpage/2026-03-10/1225002214.PDF',
  byd: 'https://www.byd.com/mea/news-list/BYD%20Unveils%202nd%20Generation%20Blade%20Battery%20and%20FLASH%20Charging%20Technology',
  bydCn: 'https://www.byd.com/cn/detail622',
  ronbayQ1: 'https://dataclouds.cninfo.com.cn/shgonggao/hsomarket/2026/20260429/8cca73c706de46c8b79911eef8974ae7.PDF',
  ronbayQ3: 'https://static.cninfo.com.cn/finalpage/2025-10-18/1224719162.PDF',
  ronbayH1: 'https://static.cninfo.com.cn/finalpage/2025-08-02/1224368822.PDF',
  hunan: 'https://static.cninfo.com.cn/finalpage/2026-04-23/1225155057.PDF',
  btrAnnual: 'https://dataclouds.cninfo.com.cn/sjother2/bse_onmarket/2026/20260424/90c2206e3ff011f18c72fa163e296ac0.pdf',
  btrBusiness: 'https://www.btrchina.com/Negativebusiness2/index.aspx',
  btrSilicon: 'https://www.btrchina.com/News/info.aspx?itemid=1272',
  btrEurope: 'https://www.btrchina.com/News/info.aspx?itemid=1326',
  shanshan: 'https://static.cninfo.com.cn/finalpage/2026-08-28/1225521372.PDF',
};

const rows = [
  ['L01','2026-03-10','양극','CATL','Zero-Carbon Technology Powers “All-Domain Growth”','CATL, 2025년 연차보고서 발표','공식 발표','2025년 리튬이온배터리 판매량이 661GWh로 전년 대비 39% 증가했다고 발표했다.','사업','중국+해외',sources.catl],
  ['L02','2026-03-10','양극','CATL','Zero-Carbon Technology Powers “All-Domain Growth”','CATL, 글로벌 생산능력 및 건설 중 캐파 공개','공식 발표','2025년 말 글로벌 생산능력 772GWh, 건설 중 생산능력 321GWh를 공개했다.','사업','중국+해외',sources.catl],
  ['L03','2026-03-10','양극','CATL','Zero-Carbon Technology Powers “All-Domain Growth”','CATL, 연구개발 투자 규모 공개','공식 발표','2025년 연구개발비 221억 위안, 지난 10년 누적 연구개발 투자 900억 위안 이상을 공개했다.','기술','중국+해외',sources.catl],
  ['L04','2026-03-10','양극','CATL','Zero-Carbon Technology Powers “All-Domain Growth”','CATL, 배터리 재활용 물량 공개','공식 발표','2025년 사용후 배터리 21만 톤을 재활용하고 리튬염 2.4만 톤을 재생했다고 밝혔다.','사업','중국',sources.catl],
  ['L05','2026-03-10','양극','CATL','零碳科技聚势，“全域增量”领航！宁德时代发布2025年年度报告','CATL, 해외 시장점유율 언급','공식 발표','SNE Research 기준 해외 동력배터리 시장점유율이 30%까지 상승했다고 밝혔다.','사업','해외',sources.catlCn],
  ['L06','2026-05-13','양극','CATL','Yutong and CATL Renew Global Strategic Memorandum','CATL-위통, 60개국 이상 공동 해외 확장 MOU','공식 발표','위통그룹과 60개국 이상을 대상으로 차량·배터리 공동 해외 확장을 추진하는 전략협력 MOU를 체결했다.','사업','해외',sources.catlYutong],
  ['L07','2025-05-20','양극','CATL','2025年年度报告全文','CATL, H주 상장 사실','거래소 공시','2025년 5월 20일 해외상장 외국주식(H주)을 상장했다고 공시했다.','사업','해외',sources.catlAnnual],
  ['L08','2026-03-05','양극','BYD','BYD Unveils 2nd Generation Blade Battery and FLASH Charging Technology','BYD, 2세대 블레이드 배터리 공개','공식 발표','2세대 블레이드 배터리와 FLASH 충전 기술을 공개했다.','기술','중국+해외',sources.byd],
  ['L09','2026-03-05','양극','BYD','BYD Unveils 2nd Generation Blade Battery and FLASH Charging Technology','BYD, 충전 성능 수치 공개','공식 발표','10%에서 70% 충전에 5분, 97% 충전에 9분이 소요된다고 발표했다.','기술','중국+해외',sources.byd],
  ['L10','2026-03-05','양극','BYD','BYD Unveils 2nd Generation Blade Battery and FLASH Charging Technology','BYD, 중국 FLASH 충전 인프라 계획','공식 발표','중국 내 FLASH 충전소 2만 개 건설 계획을 발표했다.','사업','중국',sources.byd],
  ['L11','2026-03-05','양극','BYD','BYD Unveils 2nd Generation Blade Battery and FLASH Charging Technology','BYD, FLASH 충전 인프라 해외 전개 계획','공식 발표','2026년 말부터 FLASH 충전 인프라를 글로벌로 본격 전개할 계획이라고 밝혔다.','사업','해외',sources.byd],
  ['L12','2026-05-01','양극','BYD','比亚迪第1600万辆新能源汽车下线','BYD, 2025년 해외 판매량 및 진출국 공개','공식 발표','2025년 해외 판매량이 104만 대를 넘었고 119개국에 진출했다고 밝혔다.','사업','해외',sources.bydCn],
  ['L13','2025-03-17','양극','BYD','BYD Unveils Super e-Platform with Megawatt Flash Charging','BYD, 슈퍼 e-플랫폼 공개','공식 발표','플래시 충전 배터리와 3만rpm 모터, SiC 전력 칩을 포함한 슈퍼 e-플랫폼을 발표했다.','기술','중국',sources.byd],
  ['L14','2026-04-29','양극','Ronbay','2026年第一季度报告','Ronbay, 폴란드 고니켈 생산라인 건설 일정','거래소 공시','폴란드 1기 연 2.5만 톤 고니켈 라인이 하반기 완공 및 고객 인증 단계 진입 예정이라고 공시했다.','사업','유럽',sources.ronbayQ1],
  ['L15','2026-04-29','양극','Ronbay','2026年第一季度报告','Ronbay, 구이저우 LFP·전구체 증설 착수','거래소 공시','구이저우에서 연 52만 톤 전구체와 연 34만 톤 양극재 생산능력 건설을 시작했다고 공시했다.','사업','중국',sources.ronbayQ1],
  ['L16','2026-04-29','양극','Ronbay','2026年第一季度报告','Ronbay, 중니켈 제품 고객 인증 및 출하 계획','거래소 공시','중니켈 제품이 핵심 고객 심사를 통과했으며 2026년 2분기부터 규모 출하가 예상된다고 공시했다.','기술','중국+해외',sources.ronbayQ1],
  ['L17','2026-04-29','양극','Ronbay','2026年第一季度报告','Ronbay, 한국 사업 구조조정 사실','거래소 공시','북미 시장 참여를 위해 2026년 3월 한국 사업 구조조정을 시작했다고 공시했다.','사업','북미',sources.ronbayQ1],
  ['L18','2025-10-18','양극','Ronbay','2025年第三季度报告','Ronbay, 중니켈 고전압 제품의 고객 인증','거래소 공시','중니켈 고전압 제품이 글로벌 핵심 고객의 주요 인증 단계를 통과했다고 공시했다.','기술','해외',sources.ronbayQ3],
  ['L19','2025-10-18','양극','Ronbay','2025年第三季度报告','Ronbay, LMFP 순수계 EV 양산 전망','거래소 공시','다수 EV 고객의 진전이 기대보다 빠르며 2026년 LMFP 순수계가 차량에 양산 적용될 수 있다고 공시했다.','기술','중국+해외',sources.ronbayQ3],
  ['L20','2025-10-18','양극','Ronbay','2025年第三季度报告','Ronbay, 고체전해질 파일럿 라인 계획','거래소 공시','황화물 고체전해질의 파일럿 라인을 추진 중이며 일부 양산 장비가 소재 투입 검증을 마쳤다고 공시했다.','기술','중국',sources.ronbayQ3],
  ['L21','2025-08-02','양극','Ronbay','2025年半年度报告','Ronbay, LMFP 해외 셀사 정점 인증','거래소 공시','LMFP 제품의 순수계가 해외 셀 고객의 정점 인증을 받았다고 공시했다.','기술','해외',sources.ronbayH1],
  ['L22','2025-08-02','양극','Ronbay','2025年半年度报告','Ronbay, 나트륨이온 양극 생산라인 착공','거래소 공시','후베이 셴타오에서 연 6천 톤 폴리아니온 나트륨이온 양극 생산라인을 착공했다고 공시했다.','사업','중국',sources.ronbayH1],
  ['L23','2025-08-02','양극','Ronbay','2025年半年度报告','Ronbay, 고니켈 대형 생산라인 가동','거래소 공시','자체 개발 고니켈 대형 생산라인이 가동됐으며 유효 생산능력이 월 1,200~1,400톤이라고 공시했다.','사업','중국',sources.ronbayH1],
  ['L24','2026-04-23','양극','Hunan Yuneng','2025年年度报告全文','Hunan Yuneng, 고율 충전 LFP 개발','거래소 공시','급속 충전과 긴 수명을 목표로 한 고율 인산철리튬 소재 개발 과제를 연차보고서에 기재했다.','기술','중국',sources.hunan],
  ['L25','2025-07-01','양극','Hunan Yuneng','马来西亚裕能年产9万吨锂电池正极材料项目','Hunan Yuneng, 말레이시아 9만 톤 양극재 프로젝트','거래소·공개 문서','말레이시아 연 9만 톤 리튬이온배터리 양극재 프로젝트가 공개 문서에 기재됐다.','사업','아시아(중국 제외)',sources.hunan],
  ['L26','2024-04-01','양극','Hunan Yuneng','西班牙裕能年产5万吨锂电池正极材料项目','Hunan Yuneng, 스페인 5만 톤 양극재 프로젝트','공개 문서','스페인 연 5만 톤 리튬이온배터리 양극재 프로젝트가 공개 문서에 기재됐다.','사업','유럽',sources.hunan],
  ['L27','2026-04-23','양극','Hunan Yuneng','2025年年度报告全文','Hunan Yuneng, 3세대 ESS용 LFP 개발','거래소 공시','3세대 ESS용 LFP의 전기화학 성능을 유지하면서 비용을 낮추기 위한 개발을 연차보고서에 기재했다.','기술','중국',sources.hunan],
  ['L28','2026-04-24','음극','BTR','2025年年度报告','BTR, 실리콘계 음극의 양산 이력','거래소 공시','2013년부터 실리콘탄소·실리콘산화물 음극재를 규모 생산해 왔다고 연차보고서에 기재했다.','기술','중국+해외',sources.btrAnnual],
  ['L29','2026-04-24','음극','BTR','2025年年度报告','BTR, CVD 실리콘탄소 제품 양산 출하','거래소 공시','CVD 실리콘탄소 제품이 글로벌 주요 동력 고객의 인정을 받아 양산 출하됐다고 공시했다.','기술','중국+해외',sources.btrAnnual],
  ['L30','2026-04-24','음극','BTR','2025年年度报告','BTR, 인도네시아·모로코 생산기지 언급','거래소 공시','해외 인도네시아와 모로코 생산기지를 포함한 생산능력 배치를 공시했다.','사업','해외',sources.btrAnnual],
  ['L31','2026-04-24','음극','BTR','2025年年度报告','BTR, 음극·양극·고체전해질 제품군 공개','거래소 공시','천연·인조·실리콘계 음극, 삼원계 양극, 고체전해질을 포함한 제품군을 공시했다.','기술','중국+해외',sources.btrAnnual],
  ['L32','2025-05-13','음극','BTR','投资者关系活动记录表','BTR, 국내외 고객 동시 중시 방침','거래소 공시','국내와 해외 시장을 동등하게 중시하며 해외는 현지 공급 네트워크에 의존한다고 밝혔다.','사업','중국+해외',sources.btrAnnual],
  ['L33','2025-05-13','음극','BTR','投资者关系活动记录表','BTR, 실리콘계 음극의 비용·공학화 과제 언급','거래소 공시','실리콘계 음극은 비용과 에너지밀도 프리미엄, 공학화에 시간이 필요하다고 답변했다.','기술','중국+해외',sources.btrAnnual],
  ['L34','2025-05-01','음극','BTR','硅基负极领域国际标准正式发布','BTR 주도 실리콘계 음극 국제표준 발표','회사 공식 뉴스','BTR이 주도한 실리콘계 음극 분야 국제표준이 2025년 5월 발표됐다고 회사가 밝혔다.','기술','중국+해외',sources.btrBusiness],
  ['L35','2024-12-01','음극','BTR','贝特瑞新型硅负极优势凸显','BTR, 실리콘계 음극 해외 고객 공급망 진입','회사 공식 뉴스','실리콘계 음극재가 2024년 국제 주요 고객 공급망에 진입했다고 회사가 밝혔다.','기술','해외',sources.btrSilicon],
  ['L36','2026-06-23','음극','BTR','BTR SAFE固态电池材料整体解决方案欧洲首秀','BTR, 인도네시아 8만 톤 음극재 프로젝트 가동','회사 공식 뉴스','인도네시아 1기 연 8만 톤 음극재 프로젝트가 가동돼 글로벌 고객에게 공급 중이라고 밝혔다.','사업','아시아(중국 제외)',sources.btrEurope],
  ['L37','2026-06-23','음극','BTR','BTR SAFE固态电池材料整体解决方案欧洲首秀','BTR, 모로코 음극·양극 프로젝트 착수','회사 공식 뉴스','모로코 연 6만 톤 음극재와 연 5만 톤 양극재 프로젝트를 시작했다고 밝혔다.','사업','해외',sources.btrEurope],
  ['L38','2026-06-23','음극','BTR','BTR SAFE固态电池材料整体解决方案欧洲首秀','BTR, 유럽에서 고체전지 소재 솔루션 공개','회사 공식 뉴스','유럽 AABC 행사에서 고니켈 양극·실리콘 음극·고체전해질을 포함한 고체전지 소재 솔루션을 공개했다.','기술','유럽',sources.btrEurope],
  ['L39','2026-08-28','음극','Shanshan','2026年半年度报告','Shanshan, 음극재 제품군 공개','거래소 공시','인조흑연·천연흑연·실리콘계 음극·하드카본 제품이 동력·ESS·소비자 전지에 적용된다고 공시했다.','기술','중국+해외',sources.shanshan],
  ['L40','2026-08-28','음극','Shanshan','2026年半年度报告','Shanshan, 2026년 상반기 음극재 출하 산업 통계 인용','거래소 공시','GGII 기준 2026년 상반기 중국 음극재 출하량 191만 톤, 전년 대비 48% 증가를 인용했다.','사업','중국',sources.shanshan],
  ['L41','2026-08-28','음극','Shanshan','2026年半年度报告','Shanshan, 음극재 산업 가동률 변화 인용','거래소 공시','2025년 약 70%였던 음극재 산업 가동률이 2026년 상반기 80% 이상으로 올랐다고 인용했다.','사업','중국',sources.shanshan],
  ['L42','2026-08-28','음극','Shanshan','2026年半年度报告','Shanshan, ESS 수요 성장 언급','거래소 공시','중국 ESS 배터리 출하량이 2026년 상반기 약 485GWh로 80% 이상 증가했다고 인용했다.','사업','중국',sources.shanshan],
  ['L43','2026-08-28','음극','Shanshan','2026年半年度报告','Shanshan, 수급·가격 환경 설명','거래소 공시','음극재 공급 확대 둔화와 수요 증가로 우수 생산능력이 단기 부족하고 제품 가격이 안정됐다고 설명했다.','사업','중국',sources.shanshan],
  ['L44','2026-08-28','음극','Shanshan','2026年半年度报告','Shanshan, 수요처별 음극재 시장 동력 설명','거래소 공시','ESS 성장, 상용차 전동화, 차량당 탑재량 상승, 수출 증가를 음극재 수요 동력으로 설명했다.','사업','중국+해외',sources.shanshan],
  ['L45','2025-05-13','음극','BTR','投资者关系活动记录表','BTR, 음극재 가격·수익성 압력 언급','거래소 공시','음극재 가격 하락과 생산능력 과잉, 설비 전환 투자 등이 단기 수익성에 영향을 준다고 답변했다.','사업','중국',sources.btrAnnual],
  ['L46','2025-10-18','양극','Ronbay','2025年第三季度报告','Ronbay, 유럽 LFP 라인 설계·해외 시장 개척','거래소 공시','폴란드에서 유럽 첫 LFP 생산라인 구축 가능성을 언급하며 해외 시장 개척과 라인 설계를 진행 중이라고 공시했다.','사업','유럽',sources.ronbayQ3],
  ['L47','2025-10-18','양극','Ronbay','2025年第三季度报告','Ronbay, 고니켈·초고니켈 고체전지 양극 출하','거래소 공시','고니켈·초고니켈 전고체 양극재가 10톤급 출하를 기록했다고 공시했다.','기술','중국+해외',sources.ronbayQ3],
  ['L48','2026-03-10','양극','CATL','Zero-Carbon Technology Powers “All-Domain Growth”','CATL, 글로벌 ESS 출하 선두 유지 발표','공식 발표','에너지저장용 배터리 출하에서 5년 연속 글로벌 선두를 유지했다고 밝혔다.','사업','중국+해외',sources.catl],
  ['L49','2026-05-01','양극','BYD','比亚迪第1600万辆新能源汽车下线','BYD, 글로벌 전기차 시장 진출국 확대 사실','공식 발표','2026년 2월 기준 전기차 사업이 6대륙 119개국에 진출했다고 밝혔다.','사업','해외',sources.bydCn],
  ['L50','2026-08-28','음극','Shanshan','2026年半年度报告','Shanshan, 음극재 경쟁 기준 변화 언급','거래소 공시','하류 고객이 기술 지표, 배치 일관성, 공급 보장, 비용 관리에 더 높은 요구를 제시한다고 설명했다.','사업','중국+해외',sources.shanshan],
];

const workbook = Workbook.create();
const guide = workbook.worksheets.add('사용 안내');
const labels = workbook.worksheets.add('라벨링 50건');
const rubric = workbook.worksheets.add('판정 기준');
const timeline = workbook.worksheets.add('전략 시계열 틀');

for (const sheet of [guide, labels, rubric, timeline]) sheet.showGridLines = false;

guide.getRange('A1:H1').merge();
guide.getRange('A1').values = [['China Battery Lens | 중요도 학습·검수 워크북']];
guide.getRange('A2:H2').merge();
guide.getRange('A2').values = [['중국어 원문은 링크로 확인하고, 모든 검수·판정은 한국어로 작성합니다. 뉴스 본문은 저장하지 않는 운영 원칙을 전제로 합니다.']];
guide.getRange('A4:B9').values = [
  ['검수 순서','1) 한국어 요약을 읽고 2) 원문 링크를 확인한 뒤 3) L~P열을 직접 입력합니다.'],
  ['분류','Top 10 / 소재별 중요 / 제외'],
  ['중요도','매우 높음 / 높음 / 보통 / 낮음'],
  ['관련도','당사 관련도: 매우 높음 / 높음 / 보통 / 낮음'],
  ['신뢰','회사 공식·거래소 공시 1건은 포함 가능. 단일 제3자 언론 보도만으로는 제외합니다.'],
  ['판정 원칙','AI가 전략·기술 성숙도를 추정하지 않습니다. 출처에 명시된 팩트만 시간축에 정리합니다.'],
];
guide.getRange('A11:H11').merge();
guide.getRange('A11').values = [['합의된 제품 원칙']];
guide.getRange('A12:H16').values = [
  ['Daily', '양극재·음극재만 분리', '셀사 뉴스는 공통 수요처 변화 또는 소재 영향으로 연결', '', '', '', '', ''],
  ['회사', '사업 시계열과 기술 시계열 분리', '3년 전 → 1년 전 → 현재', '', '', '', '', ''],
  ['사업 지역', '중국 내수 / 유럽 / 북미 / 아시아(중국 제외) / 기타', '국가 단위는 팩트가 있을 때만', '', '', '', '', ''],
  ['기술', '개발·인증·양산·출하라는 표현은 출처의 명시 사실일 때만 사용', '추정 금지', '', '', '', '', ''],
  ['학습', '산업 중요도와 당사 관련도를 분리', 'Top 10은 산업 영향도 우선', '', '', '', '', ''],
];
for (let row = 12; row <= 16; row += 1) guide.getRange(`C${row}:H${row}`).merge();

const headers = ['ID','발행일','소재 구분','기업','원문 제목','한국어 번역 제목','출처 유형','한국어 팩트 요약','시계열','지역','원문 URL','사용자 분류','산업 중요도','당사 관련도','판정 근거','검수 상태'];
labels.getRange('A1:P1').values = [headers];
labels.getRange(`A2:K${rows.length + 1}`).values = rows;
labels.getRange(`L2:P${rows.length + 1}`).values = Array.from({length: rows.length}, () => ['미판정','미판정','미판정','','미검수']);
labels.tables.add(`A1:P${rows.length + 1}`, true, 'LabelingTable');
labels.freezePanes.freezeRows(1);
labels.freezePanes.freezeColumns(4);

rubric.getRange('A1:F1').merge();
rubric.getRange('A1').values = [['중요도 판정 기준 — 사용자가 학습시킬 기준']];
rubric.getRange('A3:F3').values = [['판정 항목','매우 높음','높음','보통','낮음','제외']];
rubric.getRange('A4:F8').values = [
  ['산업 영향','양극/음극 공급·수요 구조를 크게 바꿈','주요 기업 또는 지역에 영향','개별 기업·제품 영향','제한적 정보','산업적 변화 없음'],
  ['팩트 강도','공식 공시/IR 또는 회사 직접 발표','공식 출처의 구체적 실행 사실','공식 출처의 일반 설명','불명확한 사실','단일 제3자 언론 보도'],
  ['사업 시계열','대형 투자·가동·고객·해외 전략','캐파·고객·지역의 명시 변화','일반 사업 설명','반복·행사성 정보','무관'],
  ['기술 시계열','출처가 인증·양산·출하를 명시','제품·공정·특허의 구체적 변화','개발·전시·연구 사실','성능 홍보만 존재','출처 불충분'],
  ['당사 관련도','당사 제품·고객·해외 전략에 직접 영향','동일 소재군의 주요 경쟁 변화','간접적인 시장 신호','참고 수준','무관'],
];
rubric.getRange('A11:G11').values = [['사용자 분류','의미','Top 10 후보 여부','필수 이유','','','']];
rubric.getRange('A12:G14').values = [
  ['Top 10','당일 산업적으로 가장 중요한 사건','예','영향 범위와 팩트 근거를 한 줄로 적기','','',''],
  ['소재별 중요','양극 또는 음극 섹션에서 볼 가치가 있는 사건','선택','소재별 영향 적기','','',''],
  ['제외','저장하되 Daily 우선순위에서 제외','아니오','반복·행사·불확실·영향 미미 중 이유 적기','','',''],
];

timeline.getRange('A1:J1').merge();
timeline.getRange('A1').values = [['회사 전략 시계열 검수 틀 — AI 추정 없이 출처에 명시된 팩트만 기록']];
timeline.getRange('A3:J3').values = [['기업','구분','전략 축','3년 전 팩트','출처','1년 전 팩트','출처','현재 팩트','출처','검수 메모']];
const companies = ['CATL','BYD','Ronbay','Hunan Yuneng','BTR','Shanshan'];
const axes = [
  ['사업','제품·화학계'],['사업','생산능력·공장'],['사업','고객·지역(중국/해외)'],['사업','투자·재무'],
  ['기술','제품·화학계'],['기술','공정·성능'],['기술','특허·표준'],['기술','출처 명시 인증·양산·출하']
];
const timelineRows = [];
for (const company of companies) for (const [kind, axis] of axes) timelineRows.push([company,kind,axis,'','','','','','','']);
timeline.getRange(`A4:J${timelineRows.length + 3}`).values = timelineRows;
timeline.tables.add(`A3:J${timelineRows.length + 3}`, true, 'TimelineTemplate');
timeline.freezePanes.freezeRows(3);

const navy = '#17365D';
const blue = '#D9EAF7';
const lightBlue = '#EEF5FB';
const green = '#E2F0D9';
const amber = '#FFF2CC';
const gray = '#F2F2F2';

for (const sheet of [guide, rubric, timeline]) {
  sheet.getRange('A1:Z1').format = { fill: navy, font: { bold: true, color: '#FFFFFF', size: 14 }, verticalAlignment: 'center' };
  sheet.getRange('A1:Z1').format.rowHeight = 28;
}
guide.getRange('A2:H2').format = { fill: lightBlue, font: { italic: true, color: '#3F3F3F' }, wrapText: true };
guide.getRange('A4:A9').format = { fill: blue, font: { bold: true } };
guide.getRange('A11:H11').format = { fill: navy, font: { bold: true, color: '#FFFFFF' } };
guide.getRange('A12:C16').format = { fill: lightBlue, wrapText: true };
rubric.getRange('A3:F3').format = { fill: navy, font: { bold: true, color: '#FFFFFF' }, wrapText: true };
rubric.getRange('A4:A8').format = { fill: blue, font: { bold: true }, wrapText: true };
rubric.getRange('A11:G11').format = { fill: navy, font: { bold: true, color: '#FFFFFF' } };
rubric.getRange('A12:G14').format = { fill: lightBlue, wrapText: true };
timeline.getRange('A3:J3').format = { fill: navy, font: { bold: true, color: '#FFFFFF' }, wrapText: true };
timeline.getRange(`A4:C${timelineRows.length + 3}`).format = { fill: lightBlue };
labels.getRange('A1:P1').format = { fill: navy, font: { bold: true, color: '#FFFFFF' }, wrapText: true, verticalAlignment: 'center' };
labels.getRange('A1:P1').format.rowHeight = 34;
labels.getRange(`A2:K${rows.length + 1}`).format.wrapText = true;
labels.getRange(`L2:P${rows.length + 1}`).format = { fill: amber, wrapText: true };
labels.getRange(`L2:L${rows.length + 1}`).dataValidation = { rule: { type: 'list', values: ['Top 10','소재별 중요','제외','미판정'] } };
labels.getRange(`M2:N${rows.length + 1}`).dataValidation = { rule: { type: 'list', values: ['매우 높음','높음','보통','낮음','미판정'] } };
labels.getRange(`P2:P${rows.length + 1}`).dataValidation = { rule: { type: 'list', values: ['검수 완료','미검수','보류'] } };
labels.getRange(`L2:L${rows.length + 1}`).conditionalFormats.add('containsText', { text: 'Top 10', format: { fill: '#C6E0B4', font: { bold: true } } });
labels.getRange(`L2:L${rows.length + 1}`).conditionalFormats.add('containsText', { text: '제외', format: { fill: '#E7E6E6', font: { color: '#666666' } } });

guide.getRange('A1:H16').format.borders = { preset: 'outside', style: 'thin', color: '#B7C9D6' };
rubric.getRange('A3:F8').format.borders = { preset: 'all', style: 'thin', color: '#D9E2F3' };
rubric.getRange('A11:G14').format.borders = { preset: 'all', style: 'thin', color: '#D9E2F3' };
timeline.getRange(`A3:J${timelineRows.length + 3}`).format.borders = { preset: 'insideHorizontal', style: 'thin', color: '#D9E2F3' };

guide.getRange('A:A').format.columnWidth = 22;
guide.getRange('B:B').format.columnWidth = 75;
guide.getRange('C:H').format.columnWidth = 18;
rubric.getRange('A:A').format.columnWidth = 20;
rubric.getRange('B:F').format.columnWidth = 28;
rubric.getRange('G:G').format.columnWidth = 14;
labels.getRange('A:A').format.columnWidth = 10;
labels.getRange('B:B').format.columnWidth = 12;
labels.getRange('C:D').format.columnWidth = 14;
labels.getRange('E:E').format.columnWidth = 34;
labels.getRange('F:F').format.columnWidth = 30;
labels.getRange('G:G').format.columnWidth = 14;
labels.getRange('H:H').format.columnWidth = 48;
labels.getRange('I:J').format.columnWidth = 16;
labels.getRange('K:K').format.columnWidth = 52;
labels.getRange('L:N').format.columnWidth = 16;
labels.getRange('O:O').format.columnWidth = 34;
labels.getRange('P:P').format.columnWidth = 14;
labels.getRange(`A2:P${rows.length + 1}`).format.rowHeight = 46;
timeline.getRange('A:C').format.columnWidth = 20;
timeline.getRange('D:D').format.columnWidth = 34;
timeline.getRange('E:E').format.columnWidth = 40;
timeline.getRange('F:F').format.columnWidth = 34;
timeline.getRange('G:G').format.columnWidth = 40;
timeline.getRange('H:H').format.columnWidth = 34;
timeline.getRange('I:I').format.columnWidth = 40;
timeline.getRange('J:J').format.columnWidth = 24;
timeline.getRange(`A4:J${timelineRows.length + 3}`).format.rowHeight = 34;

await fs.mkdir(outputDir, { recursive: true });
const xlsx = await SpreadsheetFile.exportXlsx(workbook);
await xlsx.save(outputPath);

const verification = await workbook.inspect({ kind: 'table', range: '라벨링 50건!A1:P8', include: 'values,formulas', tableMaxRows: 8, tableMaxCols: 16 });
const errors = await workbook.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A', options: { useRegex: true, maxResults: 50 }, summary: 'formula error scan' });
const previews = [
  ['사용 안내', 'A1:H16', 'preview-guide.png'],
  ['라벨링 50건', 'A1:P12', 'preview-labeling.png'],
  ['판정 기준', 'A1:G14', 'preview-rubric.png'],
  ['전략 시계열 틀', 'A1:J16', 'preview-timeline.png'],
];
for (const [sheetName, range, filename] of previews) {
  const preview = await workbook.render({ sheetName, range, scale: 1.2, format: 'png' });
  await fs.writeFile(`${outputDir}/${filename}`, new Uint8Array(await preview.arrayBuffer()));
}
console.log(JSON.stringify({ outputPath, verification: verification.ndjson, errors: errors.ndjson }));
