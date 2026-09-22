/* ---------------------------------------------------------------------------
   Panda Studio — block index content.

   Source of truth: D:\Projects\panda-studio-site-original\content\studio.ts
   plus public\content-overrides.json (the copy edited in-page, which wins for
   Chinese). English keeps the committed wording because the overrides file has
   an empty `en` block.
--------------------------------------------------------------------------- */

export const SITE = {
  zh: {
    langLabel: '中',
    eyebrow: 'PANDA 社团 · 在这里，把想法做出来',
    title: ['with AI, anything'],
    description:
      '这里汇聚不同的思考方式，也容纳尚未被定义的可能。我们通过创造、实验与协作，让想法真正发生。',
    capabilities: ['AI 协同', '3D 打印', '产品思维'],
    nav: { index: '索引', record: '作品' },
    sections: {
      index: {
        label: '01 / 索引',
        title: '一个以项目为组织方式的社团',
        hint: '九个方块。先认识这间房间，再看设备，最后选择方向。',
      },
      record: {
        label: '02 / 作品',
        title: '我们做过的事，收进一个个方块',
        hint: '七件已完成的作品。点开任意一块可以看到图片和说明。',
      },
    },
    ui: {
      brandHome: 'Panda Studio 首页',
      grid: '内容方块',
      rail: '全部方块',
      expand: (title) => `放大 ${title}`,
      detail: '方块详情',
      back: '返回方块墙',
      close: '关闭',
      previous: '上一个方块',
      next: '下一个方块',
      gallery: '图集',
      galleryCount: (n) => `${n} 张`,
      openImage: (title, n) => `查看大图：${title} 第 ${n} 张`,
      imageAlt: (title, n) => `${title} 图片 ${n}`,
      highlights: '内容',
      hintOpen: '点击任意方块放大',
      hintFocus: '点左栏切换，Esc 返回',
    },
    footer: { tagline: 'with AI, anything', backToTop: '返回顶部' },
  },
  en: {
    langLabel: 'EN',
    eyebrow: 'Independent creative studio · Est. somewhere underground',
    title: ['with AI, anything'],
    description:
      'We gather people who do not fit neatly into the usual rankings—then make strange, useful things together.',
    capabilities: ['AI collaboration', '3D printing', 'Product thinking'],
    nav: { index: 'Index', record: 'Records' },
    sections: {
      index: {
        label: '01 / Index',
        title: 'A studio organised around projects.',
        hint: 'Nine blocks. Meet the room first, then the tools, then the directions.',
      },
      record: {
        label: '02 / Records',
        title: 'Things we made, held as blocks.',
        hint: 'Seven finished records. Open any block for images and notes.',
      },
    },
    ui: {
      brandHome: 'Panda Studio home',
      grid: 'Content blocks',
      rail: 'All blocks',
      expand: (title) => `Expand ${title}`,
      detail: 'Block detail',
      back: 'Back to block wall',
      close: 'Close',
      previous: 'Previous block',
      next: 'Next block',
      gallery: 'Gallery',
      galleryCount: (n) => `${n} images`,
      openImage: (title, n) => `Open image: ${title} ${n}`,
      imageAlt: (title, n) => `${title} image ${n}`,
      highlights: 'Contents',
      hintOpen: 'Click any block to expand',
      hintFocus: 'Use the rail to switch, Esc to return',
    },
    footer: { tagline: 'with AI, anything', backToTop: 'Back to top' },
  },
};

/* Group labels used on the tile and in the detail kicker. */
const GROUPS = {
  about: { zh: '认识 Panda', en: 'Meet Panda' },
  hardware: { zh: '我们的设备', en: 'Use the tools' },
  research: { zh: '选择方向', en: 'Choose a direction' },
  record: { zh: '作品档案', en: 'Records' },
};

export const BLOCKS = [
  /* ------------------------------------------------------------------ index */
  {
    id: 'about-studio',
    group: 'index',
    section: 'about',
    num: '01',
    code: { zh: '介绍 / 01', en: 'ABOUT / 01' },
    img: 'intro-about',
    gallery: [],
    title: { zh: '社团介绍', en: 'Studio introduction' },
    summary: {
      zh: '跨专业社团，从真实问题出发，把想法做出来。',
      en: 'A cross-discipline club that starts from real problems.',
    },
    body: {
      zh: 'Panda 是一个跨专业的社团。建筑、机械、计算机等背景的同学凑到一起，我们相信最好的学习发生在把想法做出来的那一刻。\n我们从一个真实、让人不舒服的问题出发，用 AI 协同、3D 打印和快速原型，把念头变成能用手拿起、用眼睛检验的东西。\n不同专业的人各拿所长，恰恰能把一个想法推到单枪匹马做不到的程度。而我们的成果，会一起带去 iCAN、黑客松、数字媒体等竞赛的舞台上，接受真正的检验。',
      en: 'Start with a real problem, make a testable prototype, then validate it through competitions and hackathons.\nMeet the room first, then the tools that help projects take shape.',
    },
    items: {
      zh: ['跨专业组队', '真实问题出发', '原型可验证', '竞赛检验'],
      en: ['Cross-discipline team', 'Real problem', 'Testable prototype', 'Public validation'],
    },
  },
  {
    id: 'hardware-printer',
    group: 'index',
    section: 'hardware',
    num: '02',
    code: { zh: '硬件 / 01', en: 'HARDWARE / 01' },
    img: 'hw-printer',
    gallery: [],
    title: { zh: '3D 打印机', en: '3D printer' },
    summary: {
      zh: '把想法，直接打印成现实。',
      en: 'Turn an idea straight into an object.',
    },
    body: {
      zh: '把想法，直接打印成现实。\n产品原型、建筑模型、机械零件、外壳、连接件、创意作品，都可以快速制作。\n从数字模型到真实物体，用最直观的方式验证设计。',
      en: 'Turn a digital model into a physical object quickly—a prototyping tool shared by every direction.',
    },
    items: {
      zh: ['产品原型', '建筑模型', '机械零件', '外壳与连接件'],
      en: ['Product prototypes', 'Architectural models', 'Mechanical parts', 'Shells and connectors'],
    },
  },
  {
    id: 'hardware-laser',
    group: 'index',
    section: 'hardware',
    num: '03',
    code: { zh: '硬件 / 02', en: 'HARDWARE / 02' },
    img: 'hw-laser',
    gallery: ['hw-laser-2'],
    title: { zh: '激光雕刻机', en: 'Laser engraver' },
    summary: {
      zh: '用激光，把图纸精准变成零件和图案。',
      en: 'Turn drawings into parts and patterns with a laser.',
    },
    body: {
      zh: '用激光，把图纸精准变成零件和图案。\n可以对木板、亚克力、纸板等材料进行切割、雕刻、打孔和表面标记，快速制作建筑模型、展示板、标识牌、结构零件和创意作品。\n特别适合用于模型制作、快速打样和复杂图形加工，电脑里的二维图纸，可以直接变成真实材料上的成品。',
      en: 'Cut, engrave, and test sheet materials quickly.',
    },
    items: {
      zh: ['木板 / 亚克力 / 纸板', '切割与雕刻', '模型与展示板', '快速打样'],
      en: ['Wood / acrylic / board', 'Cut and engrave', 'Models and boards', 'Fast sampling'],
    },
  },
  {
    id: 'hardware-mr',
    group: 'index',
    section: 'hardware',
    num: '04',
    code: { zh: '硬件 / 03', en: 'HARDWARE / 03' },
    img: 'hw-mr',
    gallery: [],
    title: { zh: 'MR 设备', en: 'MR devices' },
    summary: {
      zh: '把数字模型，放进真实世界。',
      en: 'Put digital models into the real world.',
    },
    body: {
      zh: '把数字模型，放进真实世界。\n通过头戴设备，将虚拟模型、界面和信息叠加到真实环境中，可用于空间预览、模型展示、交互体验和方案演示。\n戴上设备后，可以直接观看和操作虚拟内容，更直观地理解建筑空间、产品模型和数字场景。',
      en: 'Build mixed-reality experiences and spatial interaction prototypes.',
    },
    items: {
      zh: ['空间预览', '模型展示', '交互体验', '方案演示'],
      en: ['Space preview', 'Model display', 'Interaction', 'Proposal review'],
    },
  },
  {
    id: 'hardware-robot-arm',
    group: 'index',
    section: 'hardware',
    num: '05',
    code: { zh: '硬件 / 04', en: 'HARDWARE / 04' },
    img: 'hw-arm',
    gallery: ['hw-arm-2'],
    title: { zh: '机械臂', en: 'Robotic arm' },
    summary: {
      zh: '让 AI 从「思考」走向「动手」。',
      en: 'Move AI from thinking into doing.',
    },
    body: {
      zh: '让 AI 从「思考」走向「动手」。\n工业机械臂可以完成抓取、搬运、加工、雕刻、装配和空间制造等任务。结合 AI 视觉识别、路径规划与智能控制后，它不仅能按照预设程序工作，还可以根据物体、环境和任务要求调整动作。\n从 AI 生成方案，到机械臂完成真实世界中的操作，让数字设计进一步转化为自动化制造。',
      en: 'Explore fabrication, motion control, and spatial making with an industrial robotic arm.',
    },
    items: {
      zh: ['AI 识别', '智能抓取', '路径规划', '自动加工', '空间制造', '人机协作'],
      en: ['Vision', 'Grasping', 'Path planning', 'Machining', 'Spatial making', 'Human–robot'],
    },
  },
  {
    id: 'research-hardware',
    group: 'index',
    section: 'research',
    num: '06',
    code: { zh: '研究 / 01', en: 'RESEARCH / 01' },
    img: 're-hardware',
    gallery: [],
    title: { zh: '小硬件', en: 'Small hardware' },
    summary: {
      zh: '传感器、电路与打印外壳组成的小型实体项目。',
      en: 'Sensors, circuits and printed shells in one compact build.',
    },
    body: {
      zh: '从传感器、电路与控制模块，到外壳设计和 3D 打印，成员可以自由组合不同技术，完成自己的小型实体项目。\n一个灯、一个交互装置、一件智能硬件，甚至一个暂时叫不出名字的新东西，都可以从这里开始。',
      en: 'Combine PCBs, sensors, and 3D-printed parts into compact physical prototypes.',
    },
    items: {
      zh: ['传感器', '电路与控制', '外壳设计', '3D 打印'],
      en: ['Sensors', 'Circuits', 'Shell design', '3D printing'],
    },
  },
  {
    id: 'research-gamification',
    group: 'index',
    section: 'research',
    num: '07',
    code: { zh: '研究 / 02', en: 'RESEARCH / 02' },
    img: 're-game',
    gallery: [],
    title: { zh: '游戏化', en: 'Gamification' },
    summary: {
      zh: '不是做游戏，而是把游戏机制带进真实问题。',
      en: 'Not games—game mechanics applied to real problems.',
    },
    body: {
      zh: '我们关注的不是「做一个游戏」，而是把游戏中的规则、反馈、挑战和成长机制带进真实问题。\n成员可以围绕学习、校园体验、交互产品或公共议题设计不同的游戏化方案，通过任务系统、积分机制、角色设定、即时反馈等方式，让原本枯燥或复杂的过程变得更直观、更有参与感，并在实际测试中不断优化体验。',
      en: 'Not simply making games—use game mechanics to help people understand or solve a problem.',
    },
    items: {
      zh: ['任务系统', '积分机制', '角色设定', '即时反馈'],
      en: ['Quests', 'Points', 'Roles', 'Instant feedback'],
    },
  },
  {
    id: 'research-campus',
    group: 'index',
    section: 'research',
    num: '08',
    code: { zh: '研究 / 03', en: 'RESEARCH / 03' },
    img: 're-campus',
    gallery: [],
    title: { zh: '校园应用', en: 'Campus applications' },
    summary: {
      zh: '从湖工大的真实场景出发，发现问题也解决问题。',
      en: 'Start from real HBUT campus scenarios.',
    },
    body: {
      zh: '从湖工大的真实场景出发，发现问题，也解决问题。\n我们会围绕校园生活中的具体需求，通过小程序、网页、智能硬件等方式进行设计与开发，在真实使用中不断测试和完善，让项目不只停留在作品里，而是真正服务于校园。',
      en: 'Start with real campus problems and connect small apps to channels, identity, and activities.',
    },
    items: {
      zh: ['小程序', '网页', '智能硬件', '真实使用测试'],
      en: ['Mini programs', 'Web apps', 'Smart hardware', 'Field testing'],
    },
  },
  {
    id: 'research-robotics',
    group: 'index',
    section: 'research',
    num: '09',
    code: { zh: '研究 / 04', en: 'RESEARCH / 04' },
    img: 're-arm',
    gallery: [],
    title: { zh: '机械臂方向', en: 'Robotic arms' },
    summary: {
      zh: '用机器视觉与智能算法驱动工业机械臂。',
      en: 'Drive an industrial arm with machine vision and planning.',
    },
    body: {
      zh: '把 AI 从屏幕里带到真实世界。\n我们通过工业机械臂、机器视觉与智能算法，探索识别、抓取、加工、装配与数字制造等方向。从程序控制开始，让机械臂逐渐具备感知环境、规划动作和完成任务的能力，并在真实设备上不断验证我们的想法。',
      en: 'Explore grasping, making, and architecture-related tasks with a full-scale robotic arm.',
    },
    items: {
      zh: ['识别', '抓取', '加工', '装配', '数字制造'],
      en: ['Recognition', 'Grasping', 'Machining', 'Assembly', 'Digital fabrication'],
    },
  },

  /* ----------------------------------------------------------------- records */
  {
    id: 'record-001',
    group: 'record',
    section: 'record',
    num: '10',
    code: { zh: 'PANDA / 3D 001', en: 'PANDA / 3D 001' },
    img: 'r001',
    gallery: [
      'r001-1', 'r001-2', 'r001-3', 'r001-4', 'r001-5', 'r001-6', 'r001-7',
      'r001-8', 'r001-9', 'r001-10', 'r001-11', 'r001-12', 'r001-13', 'r001-14',
    ],
    title: { zh: '3D 打印作品', en: '3D-printed forms' },
    summary: {
      zh: '从建模、打印到组装成型的完整记录。',
      en: 'Modelling, printing and assembly, end to end.',
    },
    body: {
      zh: '从三维建模、参数调整，到打印成型与细节组装，我们将数字创意转化为真实可触的实体作品，记录每一次从设计到落地的过程。',
      en: 'A selection of print-in-progress images, finished figures, sculptural forms, and a modelled candle holder. Specific project names are left open until they are confirmed.',
    },
    meta: { zh: '3D 打印 / 实体制作', en: '3D printing / Physical making' },
    year: 'ARCHIVE',
    items: {
      zh: ['3D 建模', '打印过程', '成品造型', '组装与细节'],
      en: ['3D modelling', 'Print in progress', 'Finished forms', 'Assembly and detail'],
    },
  },
  {
    id: 'record-002',
    group: 'record',
    section: 'record',
    num: '11',
    code: { zh: 'PANDA / DIGITAL 002', en: 'PANDA / DIGITAL 002' },
    img: 'r002',
    gallery: ['r002-1'],
    title: { zh: '校园数字场景重建', en: 'Campus digital reconstruction' },
    summary: {
      zh: '用 3DGS 还原校园空间，导入 UE5 实时展示。',
      en: 'Campus spaces rebuilt with 3DGS and shown in UE5.',
    },
    body: {
      zh: '从校园实景采集到数字场景重建，我们尝试通过 3D Gaussian Splatting 还原真实校园空间，并将成果导入 UE5 进行实时展示，同时探索 Postshot 与 Luma AI 在场景重建中的不同表现。',
      en: 'Campus spaces reconstructed with 3D Gaussian Splatting and tested in UE5, with Postshot and Luma AI outputs documented in the 2025 summary.',
    },
    meta: { zh: '3DGS / UE5 / AI', en: '3DGS / UE5 / AI' },
    year: '2025',
    items: {
      zh: ['校园场景采集', '3DGS 重建', 'UE5 Demo', 'Postshot 与 Luma AI'],
      en: ['Campus capture', '3DGS reconstruction', 'UE5 demo', 'Postshot and Luma AI'],
    },
  },
  {
    id: 'record-003',
    group: 'record',
    section: 'record',
    num: '12',
    code: { zh: 'PANDA / AI 003', en: 'PANDA / AI 003' },
    img: 'r003',
    gallery: ['r003-1'],
    title: { zh: 'AI 产品开发与黑客松获奖', en: 'AI product & hackathon award' },
    summary: {
      zh: '强调 Human in the Loop 的独立 AI 应用。',
      en: 'An independent AI product that keeps people in the loop.',
    },
    body: {
      zh: '围绕 Human in the Loop 的 AI 应用方向，董奇志学长完成了从产品构想到独立开发的完整实践，并将成果带入 AI 黑客松进行验证，最终获得三等奖。',
      en: 'An independent AI application product that keeps people in the loop. The 2025 summary records product design by Dong Qizhi and a third prize at the 18th AI Qiecuo Conference · WaytoAGI Global Hackathon (2025 October).',
    },
    meta: { zh: 'AI 应用 / 竞赛成果', en: 'AI application / Competition' },
    year: '2025',
    items: {
      zh: ['AI 应用产品设计', 'Human in the loop', '独立产品开发', '黑客松三等奖'],
      en: ['AI product design', 'Human in the loop', 'Independent development', 'Hackathon third prize'],
    },
  },
  {
    id: 'record-004',
    group: 'record',
    section: 'record',
    num: '13',
    code: { zh: 'PANDA / MODEL 004', en: 'PANDA / MODEL 004' },
    img: 'r004',
    gallery: ['r004-1', 'r004-2'],
    title: { zh: '建筑模型制作', en: 'Architectural models' },
    summary: {
      zh: '塔楼、场地与大跨度结构的三组实体模型。',
      en: 'Tower, site and long-span structural studies.',
    },
    body: {
      zh: '围绕建筑空间与结构形态，我们完成了多组实体模型制作，从塔楼形态、场地关系到大跨度结构，尝试将二维设计转化为可观察、可推敲的立体表达。',
      en: 'Three physical model studies showing tower, site, and large-span structural explorations. Project names and course information will be added after they are confirmed.',
    },
    meta: { zh: '模型制作 / 空间研究', en: 'Model making / Spatial study' },
    year: 'ARCHIVE',
    items: {
      zh: ['塔楼模型', '场地模型', '结构模型'],
      en: ['Tower study', 'Site model', 'Structural model'],
    },
  },
  {
    id: 'record-005',
    group: 'record',
    section: 'record',
    num: '14',
    code: { zh: 'PANDA / MAKE 005', en: 'PANDA / MAKE 005' },
    img: 'r005',
    gallery: ['r005-1', 'r005-2', 'r005-3', 'r005-4'],
    title: { zh: '校园文创与实体成果', en: 'Campus creative outcomes' },
    summary: {
      zh: '帆布袋、钥匙扣等校园主题的实体成果。',
      en: 'Totes, keychains and other campus-themed objects.',
    },
    body: {
      zh: '从人物形象到校园视觉，我们尝试将熟悉的校园元素重新转化，并通过布袋、钥匙扣等实体载体，让设计真正融入日常。',
      en: 'A selection of campus-themed bags, character keychains, and small physical outcomes. The production process is not labelled until it is confirmed.',
    },
    meta: { zh: '文创设计 / 实体制作', en: 'Creative design / Physical making' },
    year: 'ARCHIVE',
    items: {
      zh: ['人物设计', '校园视觉', '实体成果'],
      en: ['Character design', 'Campus identity', 'Physical outcomes'],
    },
  },
  {
    id: 'record-006',
    group: 'record',
    section: 'record',
    num: '15',
    code: { zh: 'PANDA / AWARD 006', en: 'PANDA / AWARD 006' },
    img: 'r006',
    gallery: ['r006-1', 'r006-2', 'r006-3', 'r006-4', 'r006-5'],
    title: { zh: '学长竞赛获奖', en: 'Alumni competition awards' },
    summary: {
      zh: '创意设计、校园设计与数字艺术方向的获奖记录。',
      en: 'Certificates from design, campus and digital-art competitions.',
    },
    body: {
      zh: '在创意设计、校园设计与数字艺术等方向，我们持续参与各类专业竞赛，将日常实践转化为更完整的作品，并在不同赛项中取得了一系列成果。',
      en: 'A selection of award certificates and competition results from senior students. The image itself is the primary record.',
    },
    meta: { zh: '竞赛成果 / 获奖证书', en: 'Competition / Award certificates' },
    year: 'ARCHIVE',
    items: {
      zh: ['创意设计竞赛', '校园设计竞赛', '数字艺术设计'],
      en: ['Creative design', 'Campus design', 'Digital art'],
    },
  },
  {
    id: 'record-007',
    group: 'record',
    section: 'record',
    num: '16',
    code: { zh: 'PANDA / APP 007', en: 'PANDA / APP 007' },
    img: 'r007',
    gallery: ['r007-1'],
    title: { zh: 'Mini-HBUT 校园信息服务', en: 'Mini-HBUT campus service' },
    summary: {
      zh: '把课表、成绩、电费、空教室收进一个入口。',
      en: 'Timetable, grades, power and free rooms in one entry.',
    },
    body: {
      zh: '面向校园日常信息获取场景，该项目将课表、成绩、电费、空教室等常用信息整合至统一入口，并通过课程提醒、考试安排、学校消息等功能，让校园信息的查询与管理更加集中、高效。',
      en: 'A one-stop campus information service that brings class schedules, grades, electricity usage, empty classrooms and other campus information into a more useful entry point.',
    },
    meta: { zh: '校园信息服务 / 产品设计', en: 'Campus information service / Product design' },
    year: 'ARCHIVE',
    items: {
      zh: ['一站式校园入口', '课表与成绩', '电费与空教室', '通知设置'],
      en: ['One-stop entry', 'Timetable and grades', 'Power and free rooms', 'Notification settings'],
    },
  },
];

export function groupLabel(section, locale) {
  const entry = GROUPS[section];
  return entry ? entry[locale] : '';
}
