// 그룹 → 주요 계열사 마스터.
//
// 등록 기준
// 1. 근거는 모회사가 직접 공시한 연차보고서다. 각 member의 `evidence`는 그 보고서에서
//    관계를 명시한 원문이고, 그룹의 `source`는 그 보고서 자체다.
//    언론·백과·업계 자료만 있는 관계는 넣지 않는다.
// 2. `scope`는 셀·양극재·음극재만 둔다. 분리막·장비·ESS·무역·R&D·광산·비배터리 사업은 제외한다.
// 3. 그룹당 주요 5곳 내외만 둔다. 뉴스에 이름이 등장하고 별도 발표 주체가 되는 법인을 남긴다.
// 4. 조사 대상은 밸류체인별 SNE Research 상위 5~10개사다. 그 밖의 회사는 그룹이 없다.
// 5. 비상장사는 연차보고서가 없으므로 그룹을 비워 둔다. 근거 등급을 낮추지 않는다.
//
// `search: true`인 법인만 뉴스 검색 프롬프트에 노출한다. 프롬프트 길이를 통제하기 위함이다.

export const COMPANY_GROUPS = {
  // ── 셀 ────────────────────────────────────────────────────────────────
  catl: {
    id: "catl-group",
    name_ko: "닝더스다이 그룹",
    aliases: ["时代新能源"],
    source: {
      doc_ko: "닝더스다이 2025년 연차보고서(선전거래소 공시)",
      url: "https://static.cninfo.com.cn/finalpage/2026-03-10/1225002214.PDF",
      published_at: "2026-03-09",
    },
    members: [
      { name_ko: "광둥 방푸 순환과기(BRUNP)", name_zh: "广东邦普循环科技有限公司", name_en: null, relation: "consolidated_subsidiary", scope: "cathode", note_ko: "양극재 전구체·배터리 재활용", search: true, aliases: ["广东邦普", "邦普循环", "Brunp"], evidence: "释义: 广东邦普 指 公司合并报表子公司，广东邦普循环科技有限公司" },
      { name_ko: "장쑤 스다이(江苏时代)", name_zh: "江苏时代新能源科技有限公司", name_en: null, relation: "consolidated_subsidiary", scope: "cell", search: true, aliases: ["江苏时代"], evidence: "释义: 江苏时代 指 公司合并报表子公司 / 在子公司中的权益 企业集团的构成 표" },
      { name_ko: "쓰촨 스다이(四川时代)", name_zh: "四川时代新能源科技有限公司", name_en: null, relation: "consolidated_subsidiary", scope: "cell", search: true, aliases: ["四川时代"], evidence: "在子公司中的权益 企业集团的构成 표" },
      { name_ko: "중저우 스다이(中州时代)", name_zh: "中州时代新能源科技有限公司", name_en: null, relation: "consolidated_subsidiary", scope: "cell", search: true, aliases: ["中州时代"], evidence: "释义: 中州时代 指 公司合并报表子公司，中州时代新能源科技有限公司" },
      { name_ko: "스다이 광치 동력전지(时代广汽)", name_zh: "时代广汽动力电池有限公司", name_en: null, relation: "consolidated_subsidiary", scope: "cell", note_ko: "광저우자동차그룹과의 합작 법인", search: true, aliases: ["时代广汽"], evidence: "释义: 时代广汽 指 公司合并报表子公司，时代广汽动力电池有限公司" },
    ],
  },

  byd: {
    id: "byd-group",
    name_ko: "비야디 그룹",
    // 배터리 사업 브랜드명. 아래 세 법인이 모두 BYD 합병범위에 있어 검색어로 함께 쓴다.
    aliases: ["弗迪电池", "FinDreams Battery"],
    source: {
      doc_ko: "비야디 2025년 연차보고서(선전거래소 공시)",
      url: "https://static.cninfo.com.cn/finalpage/2026-03-28/1225045351.PDF",
      published_at: "2026-03-27",
    },
    members: [
      { name_ko: "광시 푸디 전지(广西弗迪电池)", name_zh: "广西弗迪电池有限公司", name_en: null, relation: "consolidated_subsidiary", scope: "cell", search: true, aliases: ["广西弗迪电池"], evidence: "在子公司中的权益 企业集团的构成: 通过设立或投资等方式取得的重要子公司 표" },
      { name_ko: "난닝 푸디 전지(南宁弗迪电池)", name_zh: "南宁弗迪电池有限公司", name_en: null, relation: "consolidated_subsidiary", scope: "cell", search: false, aliases: ["南宁弗迪电池"], evidence: "합병재무제표 합병범위 자회사 목록" },
      { name_ko: "광시 아세안 푸디 전지(广西东盟弗迪电池)", name_zh: "广西东盟弗迪电池有限公司", name_en: null, relation: "consolidated_subsidiary", scope: "cell", search: false, aliases: ["广西东盟弗迪电池"], evidence: "합병재무제표 합병범위 자회사 목록" },
    ],
  },

  "eve-energy": {
    id: "eve-group",
    name_ko: "이브에너지 그룹",
    aliases: ["EVE Power", "亿纬"],
    source: {
      doc_ko: "이브에너지 2025년 연차보고서(선전거래소 공시)",
      url: "https://static.cninfo.com.cn/finalpage/2026-03-28/1225045391.PDF",
      published_at: "2026-03-27",
    },
    members: [
      { name_ko: "후베이 이웨이동력(亿纬动力)", name_zh: "湖北亿纬动力有限公司", name_en: null, relation: "consolidated_subsidiary", scope: "cell", search: true, aliases: ["亿纬动力", "EVE Power"], evidence: "释义: 亿纬动力 指 湖北亿纬动力有限公司 / 主要控股参股公司分析 표: 亿纬动力 子公司 制造业" },
      { name_ko: "징먼 이웨이창넝 리튬전지(荆门创能)", name_zh: "荆门亿纬创能锂电池有限公司", name_en: null, relation: "consolidated_subsidiary", scope: "cell", search: true, aliases: ["荆门创能", "荆门亿纬创能"], evidence: "释义: 荆门创能 指 荆门亿纬创能锂电池有限公司 / 主要控股参股公司分析 표: 荆门创能 子公司 制造业" },
      { name_ko: "후이저우 이웨이창넝 전지(惠州创能)", name_zh: "惠州亿纬创能电池有限公司", name_en: null, relation: "consolidated_subsidiary", scope: "cell", search: false, aliases: ["惠州创能"], evidence: "释义: 惠州创能 指 惠州亿纬创能电池有限公司 / 企业集团的构成 표" },
      { name_ko: "이브에너지 말레이시아", name_zh: null, name_en: "EVE Energy Malaysia Sdn. Bhd.", relation: "consolidated_subsidiary", scope: "cell", note_ko: "말레이시아 생산기지", search: true, aliases: ["亿纬马来西亚", "EVE ENERGY MALAYSIA"], evidence: "释义: 亿纬马来西亚 指 EVE Energy Malaysia Sdn. Bhd. / 企业集团的构成 표" },
      { name_ko: "이브파워 헝가리", name_zh: null, name_en: "EVE Power Hungary Kft.", relation: "consolidated_subsidiary", scope: "cell", note_ko: "헝가리 생산기지", search: true, aliases: ["亿纬匈牙利", "EVE Power Hungary"], evidence: "释义: 亿纬匈牙利 指 EVE Power Hungary Kft." },
    ],
  },

  gotion: {
    id: "gotion-group",
    name_ko: "궈쉬안하이테크 그룹",
    aliases: ["国轩"],
    source: {
      doc_ko: "궈쉬안하이테크 2025년 연차보고서(선전거래소 공시)",
      url: "https://static.cninfo.com.cn/finalpage/2026-04-29/1225254220.pdf",
      published_at: "2026-04-28",
    },
    members: [
      { name_ko: "허페이 궈쉬안하이테크 동력에너지(合肥国轩)", name_zh: "合肥国轩高科动力能源有限公司", name_en: null, relation: "consolidated_subsidiary", scope: "cell", search: true, aliases: ["合肥国轩", "合肥国轩高科动力能源"], evidence: "在子公司中的权益 企业集团的主要构成 표" },
      { name_ko: "난징 궈쉬안 전지(南京国轩电池)", name_zh: "南京国轩电池有限公司", name_en: null, relation: "consolidated_subsidiary", scope: "cell", search: true, aliases: ["南京国轩电池"], evidence: "在子公司中的权益 企业集团的主要构成 표" },
      { name_ko: "난퉁 궈쉬안 신에너지과기(南通国轩)", name_zh: "南通国轩新能源科技有限公司", name_en: null, relation: "consolidated_subsidiary", scope: "cell", search: true, aliases: ["南通国轩"], evidence: "在子公司中的权益 企业集团的主要构成 표" },
      { name_ko: "허페이 궈쉬안 전지소재(合肥国轩电池材料)", name_zh: "合肥国轩电池材料有限公司", name_en: null, relation: "consolidated_subsidiary", scope: "cathode", search: true, aliases: ["合肥国轩电池材料"], evidence: "在子公司中的权益 企业集团的主要构成 표" },
      { name_ko: "궈쉬안 신에너지 루장(国轩新能源（庐江）)", name_zh: "国轩新能源（庐江）有限公司", name_en: null, relation: "consolidated_subsidiary", scope: "cell", search: false, aliases: ["庐江国轩"], evidence: "在子公司中的权益 企业集团的主要构成 표" },
    ],
  },

  // ── 양극재 ────────────────────────────────────────────────────────────
  ronbay: {
    id: "ronbay-group",
    name_ko: "룽바이 그룹",
    aliases: ["容百"],
    source: {
      doc_ko: "룽바이 2025년 연차보고서(상하이거래소 공시)",
      url: "https://static.cninfo.com.cn/finalpage/2026-04-11/1225095564.PDF",
      published_at: "2026-04-10",
    },
    members: [
      { name_ko: "후베이 룽바이 리튬전지소재(湖北容百)", name_zh: "湖北容百锂电材料有限公司", name_en: null, relation: "wholly_owned_subsidiary", scope: "cathode", search: true, aliases: ["湖北容百"], evidence: "释义: 湖北容百 指 湖北容百锂电材料有限公司，公司全资子公司" },
      { name_ko: "구이저우 룽바이 리튬전지소재(贵州容百)", name_zh: "贵州容百锂电材料有限公司", name_en: null, relation: "wholly_owned_subsidiary", scope: "cathode", search: true, aliases: ["贵州容百"], evidence: "释义: 贵州容百 指 贵州容百锂电材料有限公司，公司全资子公司" },
      { name_ko: "셴타오 룽바이 리튬전지소재(仙桃容百锂电)", name_zh: "仙桃容百锂电材料有限公司", name_en: null, relation: "wholly_owned_subsidiary", scope: "cathode", search: true, aliases: ["仙桃容百锂电"], evidence: "释义: 仙桃容百锂电 指 仙桃容百锂电材料有限公司，公司全资子公司" },
      { name_ko: "한국 룽바이 신에너지소재", name_zh: "韩国容百新能源材料有限公司", name_en: "RONBAY KOREA NEW ENERGY MATERIALS CO., LTD", relation: "wholly_owned_subsidiary", scope: "cathode", note_ko: "한국 생산기지", search: true, aliases: ["韩国容百", "RONBAY KOREA"], evidence: "释义: 韩国容百 指 韩国容百新能源材料有限公司（RONBAY KOREA NEW ENERGY MATERIALS CO., LTD），公司全资子公司" },
      { name_ko: "재세에너지(JS 株式会社)", name_zh: "载世能源株式会社", name_en: "JAESE Energy Co., Ltd.", relation: "wholly_owned_subsidiary", scope: "cathode", note_ko: "한국 법인", search: true, aliases: ["JS 株式会社", "JAESE Energy"], evidence: "释义: JS 株式会社/JS 指 JAESE Energy Co.,Ltd.，载世能源株式会社，公司全资子公司" },
    ],
  },

  "hunan-yuneng": {
    id: "hunan-yuneng-group",
    name_ko: "후난위넝 그룹",
    aliases: ["裕能"],
    source: {
      doc_ko: "후난위넝 2025년 연차보고서(선전거래소 공시)",
      url: "https://static.cninfo.com.cn/finalpage/2026-04-23/1225155057.PDF",
      published_at: "2026-04-22",
    },
    members: [
      { name_ko: "광시 위넝 신에너지 전지소재(广西裕能)", name_zh: "广西裕能新能源电池材料有限公司", name_en: null, relation: "consolidated_subsidiary", scope: "cathode", search: true, aliases: ["广西裕能"], evidence: "释义 및 在子公司中的权益 企业集团的构成 표(业务性质 制造业)" },
      { name_ko: "쓰촨 위넝 신에너지 전지소재(四川裕能)", name_zh: "四川裕能新能源电池材料有限公司", name_en: null, relation: "consolidated_subsidiary", scope: "cathode", search: true, aliases: ["四川裕能"], evidence: "释义 및 在子公司中的权益 企业集团的构成 표(业务性质 制造业)" },
      { name_ko: "구이저우 위넝 신에너지 전지소재(贵州裕能)", name_zh: "贵州裕能新能源电池材料有限公司", name_en: null, relation: "consolidated_subsidiary", scope: "cathode", search: true, aliases: ["贵州裕能"], evidence: "释义 및 在子公司中的权益 企业集团的构成 표(业务性质 制造业)" },
      { name_ko: "윈난 위넝 신에너지 전지소재(云南裕能)", name_zh: "云南裕能新能源电池材料有限公司", name_en: null, relation: "consolidated_subsidiary", scope: "cathode", search: true, aliases: ["云南裕能"], evidence: "释义 및 在子公司中的权益 企业集团的构成 표(业务性质 制造业)" },
      { name_ko: "광시 위닝 신에너지소재(广西裕宁)", name_zh: "广西裕宁新能源材料有限公司", name_en: null, relation: "consolidated_subsidiary", scope: "cathode", search: false, aliases: ["广西裕宁"], evidence: "释义 및 在子公司中的权益 企业集团的构成 표(业务性质 制造业)" },
    ],
  },

  dynanonic: {
    id: "dynanonic-group",
    name_ko: "더팡나미 그룹",
    aliases: ["德方"],
    source: {
      doc_ko: "더팡나미 2025년 연차보고서(선전거래소 공시)",
      url: "https://static.cninfo.com.cn/finalpage/2026-04-29/1225249571.PDF",
      published_at: "2026-04-28",
    },
    members: [
      { name_ko: "취징 더팡나미(曲靖德方)", name_zh: "曲靖市德方纳米科技有限公司", name_en: null, relation: "wholly_owned_subsidiary", scope: "cathode", search: true, aliases: ["曲靖德方"], evidence: "释义: 曲靖德方 指 曲靖市德方纳米科技有限公司，公司的全资子公司" },
      { name_ko: "포산 더팡나미(佛山德方)", name_zh: "佛山市德方纳米科技有限公司", name_en: null, relation: "wholly_owned_subsidiary", scope: "cathode", search: true, aliases: ["佛山德方"], evidence: "释义: 佛山德方 指 佛山市德方纳米科技有限公司，公司的全资子公司" },
      { name_ko: "이빈 더팡스다이(宜宾德方时代)", name_zh: "宜宾市德方时代科技有限公司", name_en: null, relation: "lower_tier_subsidiary", scope: "cathode", note_ko: "CATL과의 합작 법인", search: true, aliases: ["宜宾德方时代", "德方时代"], evidence: "释义: 宜宾德方时代 指 宜宾市德方时代科技有限公司，公司的控股二级子公司" },
      { name_ko: "취징 더팡이웨이(德枋亿纬)", name_zh: "曲靖市德枋亿纬有限公司", name_en: null, relation: "controlled_subsidiary", scope: "cathode", note_ko: "이브에너지와의 합작 법인", search: true, aliases: ["德枋亿纬"], evidence: "释义: 德枋亿纬 指 曲靖市德枋亿纬有限公司，公司的控股子公司" },
      { name_ko: "취징 린톄과기(曲靖麟铁)", name_zh: "曲靖市麟铁科技有限公司", name_en: null, relation: "controlled_subsidiary", scope: "cathode", search: false, aliases: ["曲靖麟铁"], evidence: "释义: 曲靖麟铁 指 曲靖市麟铁科技有限公司，公司的控股子公司" },
    ],
  },

  "wanrun-new-energy": {
    id: "wanrun-group",
    name_ko: "완룬신넝 그룹",
    aliases: ["万润新能"],
    source: {
      doc_ko: "완룬신넝 2025년 연차보고서(상하이거래소 공시)",
      url: "https://static.cninfo.com.cn/finalpage/2026-04-25/1225181265.PDF",
      published_at: "2026-04-24",
    },
    members: [
      { name_ko: "후베이 훙룬가오커 신소재(虹润高科)", name_zh: "湖北虹润高科新材料有限公司", name_en: null, relation: "wholly_owned_subsidiary", scope: "cathode", search: true, aliases: ["虹润高科"], evidence: "企业集团的构成: 合并财务报表范围 명시 / 重要子公司 표 持股 100%" },
      { name_ko: "후베이 훙마이가오커 신소재(宏迈高科)", name_zh: "湖北宏迈高科新材料有限公司", name_en: null, relation: "consolidated_subsidiary", scope: "cathode", search: true, aliases: ["宏迈高科"], evidence: "企业集团的构成: 公司将虹润高科、宏迈高科、鲁北万润、万润新材等 38 家子公司纳入合并财务报表范围" },
      { name_ko: "루베이 완룬 스마트에너지(鲁北万润)", name_zh: "鲁北万润智慧能源科技（山东）有限公司", name_en: null, relation: "consolidated_subsidiary", scope: "cathode", search: true, aliases: ["鲁北万润"], evidence: "企业集团的构成: 公司将虹润高科、宏迈高科、鲁北万润、万润新材等 38 家子公司纳入合并财务报表范围" },
    ],
  },

  lopal: {
    id: "lopal-group",
    name_ko: "룽판과기 그룹",
    aliases: ["锂源", "LBM"],
    source: {
      doc_ko: "룽판과기 2025년 연차보고서(상하이거래소 공시)",
      url: "https://static.cninfo.com.cn/finalpage/2026-04-25/1225195645.PDF",
      published_at: "2026-04-24",
    },
    members: [
      { name_ko: "창저우 리위안 신에너지과기그룹(常州锂源)", name_zh: "常州锂源新能源科技集团有限公司", name_en: null, relation: "controlled_subsidiary", scope: "cathode", note_ko: "LFP 양극재 주력 법인", search: true, aliases: ["常州锂源", "锂源新能源"], evidence: "释义: 常州锂源 指 常州锂源新能源科技集团有限公司，本公司控股子公司" },
      { name_ko: "쓰촨 리위안 신소재(四川锂源)", name_zh: "四川锂源新材料有限公司", name_en: null, relation: "lower_tier_subsidiary", scope: "cathode", search: true, aliases: ["四川锂源"], evidence: "释义: 四川锂源 指 四川锂源新材料有限公司，本公司控股孙公司" },
      { name_ko: "후베이 리위안 신에너지과기(湖北锂源)", name_zh: "湖北锂源新能源科技有限公司", name_en: null, relation: "lower_tier_subsidiary", scope: "cathode", search: false, aliases: ["湖北锂源"], evidence: "释义: 湖北锂源 指 湖北锂源新能源科技有限公司，本公司控股孙公司" },
      { name_ko: "이춘 룽판스다이 리튬업과기(宜春龙蟠时代)", name_zh: "宜春龙蟠时代锂业科技有限公司", name_en: null, relation: "controlled_subsidiary", scope: "cathode", note_ko: "CATL과의 합작 법인", search: true, aliases: ["宜春龙蟠时代", "龙蟠时代"], evidence: "释义: 宜春龙蟠时代 指 宜春龙蟠时代锂业科技有限公司，本公司控股子公司" },
      { name_ko: "LBM 에너지 인도네시아", name_zh: null, name_en: "PT LBM ENERGI BARU INDONESIA", relation: "lower_tier_subsidiary", scope: "cathode", note_ko: "인도네시아 생산기지", search: true, aliases: ["LBM ENERGI BARU", "锂源印尼"], evidence: "释义: 锂源印尼 指 PT LBM ENERGI BARU INDONESIA，本公司三级控股子公司" },
    ],
  },

  // 사명 변경: 2024-08-09자로 湖南长远锂科 → 五矿新能源材料（湖南）. 회사 ID는 DB 정합성을 위해 유지한다.
  "changyuan-lico": {
    id: "wukuang-xinneng-group",
    name_ko: "우쾅신넝 그룹",
    aliases: ["五矿新能", "长远锂科"],
    source: {
      doc_ko: "우쾅신넝 2025년 연차보고서(상하이거래소 공시)",
      url: "https://static.cninfo.com.cn/finalpage/2026-04-29/1225227477.PDF",
      published_at: "2026-04-28",
    },
    members: [
      { name_ko: "진츠 에너지소재(金驰能源材料)", name_zh: "金驰能源材料有限公司", name_en: null, relation: "wholly_owned_subsidiary", scope: "cathode", note_ko: "삼원계 전구체", search: true, aliases: ["金驰能源", "金驰能源材料"], evidence: "释义: 金驰 指 金驰能源材料有限公司，公司全资子公司 / 企业集团的构成 표" },
      { name_ko: "후난 창위안리커 신에너지(长远锂科新能源)", name_zh: "湖南长远锂科新能源有限公司", name_en: null, relation: "wholly_owned_subsidiary", scope: "cathode", search: true, aliases: ["长远锂科新能源"], evidence: "释义: 指 湖南长远锂科新能源有限公司，公司全资子公司 / 企业集团的构成 표" },
    ],
  },

  // ── 음극재 ────────────────────────────────────────────────────────────
  btr: {
    id: "btr-group",
    name_ko: "베이터루이 그룹",
    aliases: ["贝特瑞"],
    source: {
      doc_ko: "베이터루이 2025년 연차보고서(북경거래소 공시)",
      url: "https://static.cninfo.com.cn/finalpage/2026-04-24/1225197178.PDF",
      published_at: "2026-04-23",
    },
    members: [
      { name_ko: "인도네시아 베이터루이 신에너지소재(印尼贝特瑞)", name_zh: "印尼贝特瑞新能源材料有限公司", name_en: null, relation: "controlled_subsidiary", scope: "anode", note_ko: "인도네시아 생산기지", search: true, aliases: ["印尼贝特瑞"], evidence: "释义: 指 印尼贝特瑞新能源材料有限公司，公司控股子公司 / 主要控股参股公司分析 표: 主要业务 锂离子电池负极材料의 研发·生产·销售" },
      { name_ko: "베이터루이 지중해 음극 신소재(贝特瑞地中海)", name_zh: "贝特瑞地中海负极新材料科技有限公司", name_en: null, relation: "wholly_owned_subsidiary", scope: "anode", note_ko: "모로코 프로젝트 법인", search: true, aliases: ["贝特瑞地中海"], evidence: "释义: 指 贝特瑞地中海负极新材料科技有限公司，公司全资子公司" },
      { name_ko: "베이터루이 장쑤 신에너지소재(江苏新能源)", name_zh: "贝特瑞（江苏）新能源材料有限公司", name_en: null, relation: "wholly_owned_subsidiary", scope: "anode", search: true, aliases: ["贝特瑞（江苏）新能源材料"], evidence: "释义: 指 贝特瑞（江苏）新能源材料有限公司，公司全资子公司 / 主要控股参股公司分析 표: 主要业务 锂离子电池负极材料" },
      { name_ko: "쓰촨 루이안 신소재과기(四川瑞鞍)", name_zh: "四川瑞鞍新材料科技有限公司", name_en: null, relation: "controlled_subsidiary", scope: "anode", search: true, aliases: ["四川瑞鞍"], evidence: "释义: 指 四川瑞鞍新材料科技有限公司，公司控股子公司 / 主要控股参股公司分析 표: 主要业务 锂离子电池负极材料" },
      { name_ko: "후이저우 베이터루이 신소재과기(惠州贝特瑞)", name_zh: "惠州市贝特瑞新材料科技有限公司", name_en: null, relation: "wholly_owned_subsidiary", scope: "anode", search: false, aliases: ["惠州市贝特瑞"], evidence: "释义: 指 惠州市贝特瑞新材料科技有限公司，公司全资子公司 / 主要控股参股公司分析 표: 主要业务 锂离子电池负极材料 및 石墨制品加工" },
    ],
  },

  shanshan: {
    id: "shanshan-group",
    name_ko: "샨샨 그룹",
    aliases: ["杉杉"],
    source: {
      doc_ko: "샨샨 2025년 연차보고서(상하이거래소 공시)",
      url: "https://static.cninfo.com.cn/finalpage/2026-04-30/1225263241.PDF",
      published_at: "2026-04-29",
    },
    members: [
      { name_ko: "닝보 샨샨 신소재과기(宁波杉杉新材料)", name_zh: "宁波杉杉新材料科技有限公司", name_en: null, relation: "consolidated_subsidiary", scope: "anode", search: true, aliases: ["宁波杉杉新材料"], evidence: "在其他主体中的权益 企业集团的构成 重要子公司 표(지분 100%)" },
      { name_ko: "상하이 샨샨 신소재(上海杉杉新材料)", name_zh: "上海杉杉新材料有限公司", name_en: null, relation: "consolidated_subsidiary", scope: "anode", search: true, aliases: ["上海杉杉新材料"], evidence: "在其他主体中的权益 企业集团的构成 重要子公司 표(지분 100%)" },
      { name_ko: "네이멍구 샨샨과기(内蒙古杉杉科技)", name_zh: "内蒙古杉杉科技有限公司", name_en: null, relation: "consolidated_subsidiary", scope: "anode", search: true, aliases: ["内蒙古杉杉科技"], evidence: "在其他主体中的权益 企业集团的构成: 합병재무제표 범위 자회사로 기재" },
      { name_ko: "윈난 샨샨 신소재(云南杉杉新材料)", name_zh: "云南杉杉新材料有限公司", name_en: null, relation: "consolidated_subsidiary", scope: "anode", search: false, aliases: ["云南杉杉新材料"], evidence: "在其他主体中的权益 企业集团的构成: 합병재무제표 범위 자회사로 기재" },
      { name_ko: "쓰촨 샨샨 신소재(四川杉杉新材料)", name_zh: "四川杉杉新材料有限公司", name_en: null, relation: "consolidated_subsidiary", scope: "anode", search: false, aliases: ["四川杉杉新材料"], evidence: "在其他主体中的权益 企业集团的构成: 합병재무제표 범위 자회사로 기재" },
    ],
  },

  putailai: {
    id: "putailai-group",
    name_ko: "푸타이라이 그룹",
    aliases: ["紫宸"],
    source: {
      doc_ko: "푸타이라이 2025년 연차보고서(상하이거래소 공시)",
      url: "https://static.cninfo.com.cn/finalpage/2026-03-06/1224998510.PDF",
      published_at: "2026-03-05",
    },
    members: [
      { name_ko: "장시 쯔천과기(江西紫宸)", name_zh: "江西紫宸科技有限公司", name_en: null, relation: "consolidated_subsidiary", scope: "anode", search: true, aliases: ["江西紫宸", "紫宸科技"], evidence: "在其他主体中的权益 企业集团的构成 자회사 표" },
      { name_ko: "쓰촨 쯔천과기(四川紫宸)", name_zh: "四川紫宸科技有限公司", name_en: null, relation: "consolidated_subsidiary", scope: "anode", search: true, aliases: ["四川紫宸"], evidence: "在其他主体中的权益 企业集团的构成 자회사 표" },
      { name_ko: "리양 쯔천 신소재과기(溧阳紫宸)", name_zh: "溧阳紫宸新材料科技有限公司", name_en: null, relation: "consolidated_subsidiary", scope: "anode", search: false, aliases: ["溧阳紫宸"], evidence: "在其他主体中的权益 企业集团的构成 자회사 표" },
      { name_ko: "지린 쯔천과기(吉林紫宸)", name_zh: "吉林紫宸科技有限公司", name_en: null, relation: "consolidated_subsidiary", scope: "anode", search: false, aliases: ["吉林紫宸"], evidence: "在其他主体中的权益 企业集团的构成 자회사 표" },
      { name_ko: "안후이 쯔천과기(安徽紫宸)", name_zh: "安徽紫宸科技有限公司", name_en: null, relation: "consolidated_subsidiary", scope: "anode", search: false, aliases: ["安徽紫宸"], evidence: "在其他主体中的权益 企业集团的构成 자회사 표" },
    ],
  },

  "zhongke-electric": {
    id: "zhongke-group",
    name_ko: "중커전기 그룹",
    aliases: ["中科星城", "Shinzoom"],
    source: {
      doc_ko: "중커전기 2025년 연차보고서(선전거래소 공시)",
      url: "https://static.cninfo.com.cn/finalpage/2026-04-29/1225248167.PDF",
      published_at: "2026-04-28",
    },
    members: [
      { name_ko: "후난 중커싱청 흑연(湖南中科星城)", name_zh: "湖南中科星城石墨有限公司", name_en: null, relation: "consolidated_subsidiary", scope: "anode", note_ko: "음극재 주력 법인", search: true, aliases: ["湖南中科星城", "中科星城石墨"], evidence: "释义 및 在子公司中的权益 企业集团的构成 표(业务性质 锂离子电池负极材料及相关产品生产·销售)" },
      { name_ko: "구이저우 중커싱청 흑연(贵州中科星城)", name_zh: "贵州中科星城石墨有限公司", name_en: null, relation: "consolidated_subsidiary", scope: "anode", search: true, aliases: ["贵州中科星城"], evidence: "释义 및 企业集团的构成 표(业务性质 锂离子电池负极材料及相关产品加工)" },
      { name_ko: "윈난 중커싱청 흑연(云南中科星城)", name_zh: "云南中科星城石墨有限公司", name_en: null, relation: "consolidated_subsidiary", scope: "anode", search: true, aliases: ["云南中科星城"], evidence: "释义 및 企业集团的构成 표(业务性质 锂离子电池负极材料及相关产品加工)" },
      { name_ko: "쓰촨 중커싱청 흑연(四川中科星城)", name_zh: "四川中科星城石墨有限公司", name_en: null, relation: "consolidated_subsidiary", scope: "anode", search: false, aliases: ["四川中科星城"], evidence: "释义 및 企业集团的构成 표(业务性质 锂离子电池负极材料及相关产品加工)" },
      { name_ko: "중커싱청 수하르 신소재과기(中科星城苏哈尔)", name_zh: "中科星城苏哈尔新材料科技（自贸区）有限责任公司", name_en: null, relation: "consolidated_subsidiary", scope: "anode", note_ko: "오만 소하르 자유무역구 법인", search: true, aliases: ["中科星城苏哈尔", "苏哈尔"], evidence: "释义 자회사 목록" },
    ],
  },

  "shangtai-technology": {
    id: "shangtai-group",
    name_ko: "상타이과기 그룹",
    aliases: ["尚太"],
    source: {
      doc_ko: "상타이과기 2025년 연차보고서(선전거래소 공시)",
      url: "https://static.cninfo.com.cn/finalpage/2026-04-22/1225138388.PDF",
      published_at: "2026-04-21",
    },
    members: [
      { name_ko: "산시 상타이 리튬전지과기(山西尚太)", name_zh: "山西尚太锂电科技有限公司", name_en: null, relation: "wholly_owned_subsidiary", scope: "anode", note_ko: "음극재 주력 생산기지", search: true, aliases: ["山西尚太"], evidence: "释义: 山西尚太 指 山西尚太锂电科技有限公司，系公司全资子公司 / 企业集团的构成 표" },
      { name_ko: "상타이 테크놀로지 말레이시아", name_zh: null, name_en: "SHANGTAI TECHNOLOGY (MALAYSIA) SDN. BHD.", relation: "lower_tier_subsidiary", scope: "anode", note_ko: "말레이시아 생산기지", search: true, aliases: ["尚太马来西亚", "SHANGTAI TECHNOLOGY (MALAYSIA)"], evidence: "释义: 指 SHANGTAI TECHNOLOGY (MALAYSIA) SDN. BHD.，系公司全资孙公司，新加坡尚太全资子公司" },
      { name_ko: "스자좡 나구이 신에너지소재(纳硅新能源)", name_zh: "石家庄纳硅新能源材料有限公司", name_en: null, relation: "wholly_owned_subsidiary", scope: "anode", note_ko: "실리콘계 음극재", search: true, aliases: ["纳硅新能源"], evidence: "释义: 指 石家庄纳硅新能源材料有限公司，系公司全资子公司" },
      { name_ko: "상타이 테크놀로지 싱가포르", name_zh: null, name_en: "SHANGTAI TECHNOLOGY (SINGAPORE) PTE. LTD.", relation: "wholly_owned_subsidiary", scope: "anode", search: false, aliases: ["尚太新加坡"], evidence: "释义: 指 SHANGTAI TECHNOLOGY (SINGAPORE) PTE. LTD.，系公司全资子公司" },
      { name_ko: "상하이 상타이카이앙 신소재(上海尚太凯昂)", name_zh: "上海尚太凯昂新材料有限公司", name_en: null, relation: "wholly_owned_subsidiary", scope: "anode", search: false, aliases: ["上海尚太凯昂"], evidence: "释义: 上海尚太 指 上海尚太凯昂新材料有限公司，系公司全资子公司" },
    ],
  },
};

export function groupFor(companyId) {
  return COMPANY_GROUPS[companyId] || null;
}

export function groupMembers(companyId) {
  return groupFor(companyId)?.members || [];
}

// 회사 별칭 매칭에 쓰는 문자열. 그룹 브랜드명과 각 계열사의 중문·영문명·별칭을 모두 포함한다.
export function groupAliases(companyId) {
  const group = groupFor(companyId);
  if (!group) return [];
  const aliases = [...(group.aliases || [])];
  for (const member of group.members) {
    if (member.name_zh) aliases.push(member.name_zh);
    if (member.name_en) aliases.push(member.name_en);
    aliases.push(...(member.aliases || []));
  }
  return [...new Set(aliases.filter(Boolean))];
}

// 검색 프롬프트에 넣는 계열사. 프롬프트가 길어지지 않도록 search:true만 쓴다.
export function groupSearchEntities(companyId) {
  return groupMembers(companyId)
    .filter((member) => member.search)
    .map((member) => {
      const original = member.name_zh || member.name_en;
      return member.name_zh && member.name_en ? `${member.name_zh}(${member.name_en})` : original;
    })
    .filter(Boolean);
}

// 기사 본문·제목에서 발견된 계열사를 event.entity_names에 넣기 위한 매칭.
// LLM 추출 대신 등록된 별칭만 쓰므로 없는 법인명이 만들어지지 않는다.
export function matchGroupEntities(companyId, text) {
  const corpus = String(text || "").toLowerCase();
  if (!corpus) return [];
  const matched = groupMembers(companyId)
    .filter((member) => [member.name_zh, member.name_en, ...(member.aliases || [])]
      .filter(Boolean)
      .some((alias) => corpus.includes(String(alias).toLowerCase())))
    .map((member) => member.name_zh || member.name_en);
  return [...new Set(matched.filter(Boolean))];
}

// API·화면에 내보내는 요약. 근거를 함께 넘겨 화면에서 출처를 확인할 수 있게 한다.
export function groupSummary(companyId) {
  const group = groupFor(companyId);
  if (!group) return null;
  return {
    id: group.id,
    name_ko: group.name_ko,
    source: group.source,
    members_ko: group.members.map((member) => member.name_ko),
    members: group.members.map(({ name_ko, name_zh, name_en, relation, scope, note_ko, evidence }) => ({ name_ko, name_zh, name_en, relation, scope, note_ko: note_ko || null, evidence })),
  };
}
