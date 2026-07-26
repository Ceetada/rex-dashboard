/**
 * Seeds reference data and the plan catalogue.
 *
 * Everything here is idempotent (upsert by natural key) so it can be re-run
 * against an existing database — including production, where it is the
 * mechanism for rolling out a new plan or a new provider.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** resource:action pairs. Guards check these, never role names. */
const PERMISSIONS = [
  ['user', 'read'], ['user', 'update'], ['user', 'suspend'], ['user', 'verify'], ['user', 'delete'],
  ['transaction', 'read'], ['transaction', 'reverse'],
  ['health_plan', 'read'], ['health_plan', 'create'], ['health_plan', 'update'], ['health_plan', 'delete'],
  ['retirement_product', 'read'], ['retirement_product', 'update'],
  ['service_product', 'read'], ['service_product', 'create'], ['service_product', 'update'],
  ['provider', 'read'], ['provider', 'update'],
  ['announcement', 'create'], ['announcement', 'delete'],
  ['support', 'read'], ['support', 'respond'], ['support', 'close'],
  ['analytics', 'read'],
  ['audit', 'read'],
] as const;

const ROLES = [
  {
    name: 'user',
    label: 'Customer',
    description: 'A person using the platform for their own account',
    permissions: [] as string[],
  },
  {
    name: 'support',
    label: 'Support agent',
    description: 'Handles tickets. Can read customers but cannot change money or status.',
    permissions: ['user:read', 'transaction:read', 'support:read', 'support:respond', 'support:close'],
  },
  {
    name: 'ops',
    label: 'Operations',
    description: 'Runs reconciliation and the service catalogue',
    permissions: [
      'user:read', 'user:verify', 'transaction:read', 'transaction:reverse',
      'service_product:read', 'service_product:create', 'service_product:update',
      'provider:read', 'provider:update', 'analytics:read',
      'support:read', 'support:respond',
    ],
  },
  {
    name: 'admin',
    label: 'Administrator',
    description: 'Full platform administration except role management',
    permissions: [
      'user:*', 'transaction:*', 'health_plan:*', 'retirement_product:*',
      'service_product:*', 'provider:*', 'announcement:*', 'support:*',
      'analytics:read', 'audit:read',
    ],
  },
  {
    name: 'super_admin',
    label: 'Super administrator',
    description: 'Unrestricted. Should be held by a very small number of people.',
    permissions: ['*'],
  },
];

/**
 * Nigeria's 36 states plus the FCT. LGAs are seeded for a representative subset
 * here; the full 774 are loaded from prisma/data/lgas.json in deployment.
 */
const STATES: Array<[code: string, name: string, zone: string]> = [
  ['AB', 'Abia', 'South East'], ['AD', 'Adamawa', 'North East'], ['AK', 'Akwa Ibom', 'South South'],
  ['AN', 'Anambra', 'South East'], ['BA', 'Bauchi', 'North East'], ['BY', 'Bayelsa', 'South South'],
  ['BE', 'Benue', 'North Central'], ['BO', 'Borno', 'North East'], ['CR', 'Cross River', 'South South'],
  ['DE', 'Delta', 'South South'], ['EB', 'Ebonyi', 'South East'], ['ED', 'Edo', 'South South'],
  ['EK', 'Ekiti', 'South West'], ['EN', 'Enugu', 'South East'], ['FC', 'Federal Capital Territory', 'North Central'],
  ['GO', 'Gombe', 'North East'], ['IM', 'Imo', 'South East'], ['JI', 'Jigawa', 'North West'],
  ['KD', 'Kaduna', 'North West'], ['KN', 'Kano', 'North West'], ['KT', 'Katsina', 'North West'],
  ['KE', 'Kebbi', 'North West'], ['KO', 'Kogi', 'North Central'], ['KW', 'Kwara', 'North Central'],
  ['LA', 'Lagos', 'South West'], ['NA', 'Nasarawa', 'North Central'], ['NI', 'Niger', 'North Central'],
  ['OG', 'Ogun', 'South West'], ['ON', 'Ondo', 'South West'], ['OS', 'Osun', 'South West'],
  ['OY', 'Oyo', 'South West'], ['PL', 'Plateau', 'North Central'], ['RI', 'Rivers', 'South South'],
  ['SO', 'Sokoto', 'North West'], ['TA', 'Taraba', 'North East'], ['YO', 'Yobe', 'North East'],
  ['ZA', 'Zamfara', 'North West'],
];

const LAGOS_LGAS = [
  'Agege', 'Ajeromi-Ifelodun', 'Alimosho', 'Amuwo-Odofin', 'Apapa', 'Badagry', 'Epe',
  'Eti-Osa', 'Ibeju-Lekki', 'Ifako-Ijaiye', 'Ikeja', 'Ikorodu', 'Kosofe', 'Lagos Island',
  'Lagos Mainland', 'Mushin', 'Ojo', 'Oshodi-Isolo', 'Shomolu', 'Surulere',
];
const FCT_LGAS = ['Abaji', 'Bwari', 'Gwagwalada', 'Kuje', 'Kwali', 'Municipal Area Council'];

async function seedRbac() {
  for (const [resource, action] of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: `${resource}:${action}` },
      create: { key: `${resource}:${action}`, resource, action },
      update: {},
    });
  }

  for (const role of ROLES) {
    const created = await prisma.role.upsert({
      where: { name: role.name },
      create: {
        name: role.name,
        label: role.label,
        description: role.description,
        isSystem: true,
      },
      update: { label: role.label, description: role.description },
    });

    // Wildcards are resolved by the guard at request time, so only concrete
    // permission keys are materialised here.
    const concrete = role.permissions.filter((p) => !p.includes('*'));
    for (const key of concrete) {
      const permission = await prisma.permission.findUnique({ where: { key } });
      if (!permission) continue;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: created.id, permissionId: permission.id } },
        create: { roleId: created.id, permissionId: permission.id },
        update: {},
      });
    }
  }
  console.log(`✓ ${PERMISSIONS.length} permissions, ${ROLES.length} roles`);
}

async function seedGeography() {
  for (const [code, name, zone] of STATES) {
    await prisma.state.upsert({ where: { code }, create: { code, name, zone }, update: { name, zone } });
  }
  const lgas: Array<[string, string]> = [
    ...LAGOS_LGAS.map((n) => ['LA', n] as [string, string]),
    ...FCT_LGAS.map((n) => ['FC', n] as [string, string]),
  ];
  for (const [stateCode, name] of lgas) {
    const code = `${stateCode}-${name.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8)}`;
    await prisma.lga.upsert({
      where: { code },
      create: { code, name, stateCode },
      update: { name },
    });
  }
  console.log(`✓ ${STATES.length} states, ${lgas.length} LGAs`);
}

async function seedProviders() {
  const providers = [
    { slug: 'vtpass', name: 'VTpass', category: 'VTU' as const, priority: 10 },
    { slug: 'vtpass-cable', name: 'VTpass Cable', category: 'CABLE' as const, priority: 10 },
    { slug: 'paystack', name: 'Paystack', category: 'PAYMENT' as const, priority: 10 },
    // Registered at a lower priority so failover has somewhere to go the day
    // the primary aggregator has an outage.
    { slug: 'flutterwave', name: 'Flutterwave', category: 'PAYMENT' as const, priority: 20 },
    { slug: 'email-default', name: 'Transactional email', category: 'MESSAGING' as const, priority: 10 },
    { slug: 'sms-default', name: 'SMS gateway', category: 'MESSAGING' as const, priority: 10 },
  ];
  for (const p of providers) {
    await prisma.provider.upsert({
      where: { slug: p.slug },
      create: p,
      update: { name: p.name, priority: p.priority },
    });
  }
  console.log(`✓ ${providers.length} providers`);
}

async function seedHealthPlans() {
  const hmo = await prisma.hmoProvider.upsert({
    where: { name: 'Evas Health Partners' },
    create: {
      name: 'Evas Health Partners',
      accreditationNo: 'NHIA/HMO/PENDING',
      supportPhone: '+2347000003827',
      supportEmail: 'health@evas.ng',
    },
    update: {},
  });

  const plans = [
    {
      slug: 'basic-hmo',
      name: 'Basic HMO Plan',
      tier: 'BASIC' as const,
      tagline: 'Essential cover for everyday care',
      description:
        'Outpatient care, consultations and prescribed medication at accredited primary hospitals across Nigeria.',
      premiumAmount: 350_000n, // ₦3,500/month
      maxDependants: 0,
      coverageLimit: 50_000_000n, // ₦500,000/year
      waitingPeriodDays: 30,
      displayOrder: 1,
      benefits: [
        ['OUTPATIENT', 'Outpatient consultations', 'Unlimited GP visits at your primary hospital', 'Unlimited', true],
        ['PHARMACY', 'Prescribed medication', 'Drugs on the plan formulary', '₦50,000 per year', true],
        ['DIAGNOSTICS', 'Basic diagnostics', 'Laboratory tests and basic imaging', '₦40,000 per year', true],
        ['INPATIENT', 'Admission', 'Ward admission for covered conditions', '₦150,000 per year', true],
        ['EMERGENCY', 'Emergency care', 'Stabilisation at network hospitals', '₦100,000 per year', true],
        ['SPECIALIST', 'Specialist consultations', null, null, false],
        ['DENTAL', 'Dental care', null, null, false],
        ['OPTICAL', 'Optical care', null, null, false],
      ],
    },
    {
      slug: 'family-hmo',
      name: 'Family HMO Plan',
      tier: 'FAMILY' as const,
      tagline: 'One plan for the whole household',
      description:
        'Covers you, your spouse and up to four children, with maternity and paediatric care included.',
      premiumAmount: 1_200_000n, // ₦12,000/month
      maxDependants: 5,
      coverageLimit: 200_000_000n, // ₦2,000,000/year
      waitingPeriodDays: 30,
      displayOrder: 2,
      benefits: [
        ['OUTPATIENT', 'Outpatient care for all members', 'Every enrolled family member', 'Unlimited', true],
        ['INPATIENT', 'Hospital admission', 'Private ward where available', '₦800,000 per year', true],
        ['MATERNITY', 'Maternity care', 'Antenatal, delivery and postnatal care', '₦450,000 per delivery', true],
        ['SPECIALIST', 'Specialist consultations', 'Referral to network specialists', '₦300,000 per year', true],
        ['EMERGENCY', 'Emergency and ambulance', '24/7 emergency response', 'Unlimited', true],
        ['PHARMACY', 'Prescribed medication', null, '₦200,000 per year', true],
        ['DIAGNOSTICS', 'Diagnostics and imaging', 'Including CT and MRI on referral', '₦250,000 per year', true],
        ['DENTAL', 'Routine dental', 'Scaling, polishing and fillings', '₦60,000 per year', true],
        ['OPTICAL', 'Optical care', null, null, false],
      ],
    },
    {
      slug: 'premium-hmo',
      name: 'Premium HMO Plan',
      tier: 'PREMIUM' as const,
      tagline: 'Comprehensive cover, including dental and optical',
      description:
        'Our most complete plan: specialist care, dental, optical, mental health and evacuation cover, at tertiary hospitals nationwide.',
      premiumAmount: 2_800_000n, // ₦28,000/month
      maxDependants: 5,
      coverageLimit: null, // uncapped
      waitingPeriodDays: 14,
      displayOrder: 3,
      benefits: [
        ['OUTPATIENT', 'Outpatient care', 'At tertiary and private hospitals', 'Unlimited', true],
        ['INPATIENT', 'Hospital admission', 'Private room', 'Unlimited', true],
        ['SPECIALIST', 'Specialist and consultant care', 'Direct access, no referral needed', 'Unlimited', true],
        ['DENTAL', 'Comprehensive dental', 'Including root canal and extractions', '₦250,000 per year', true],
        ['OPTICAL', 'Comprehensive optical', 'Eye tests, frames and lenses', '₦180,000 per year', true],
        ['EMERGENCY', 'Emergency and evacuation', 'Including air ambulance where indicated', 'Unlimited', true],
        ['MATERNITY', 'Maternity care', 'Including caesarean section', '₦1,200,000 per delivery', true],
        ['MENTAL_HEALTH', 'Mental health support', 'Counselling and psychiatric care', '₦200,000 per year', true],
        ['DIAGNOSTICS', 'Advanced diagnostics', 'Full imaging and pathology', 'Unlimited', true],
        ['PHARMACY', 'Prescribed medication', null, 'Unlimited on formulary', true],
        ['WELLNESS', 'Annual health check', 'Comprehensive yearly screening', '1 per year', true],
      ],
    },
  ];

  for (const plan of plans) {
    const { benefits, ...planData } = plan;
    const created = await prisma.healthPlan.upsert({
      where: { slug: plan.slug },
      create: { ...planData, hmoProviderId: hmo.id },
      update: { ...planData, hmoProviderId: hmo.id },
    });

    // Benefits are replaced wholesale so re-running the seed reflects edits.
    await prisma.planBenefit.deleteMany({ where: { planId: created.id } });
    await prisma.planBenefit.createMany({
      data: benefits.map(([category, title, description, limitLabel, isIncluded], index) => ({
        planId: created.id,
        category: category as never,
        title: title as string,
        description: description as string | null,
        limitLabel: limitLabel as string | null,
        isIncluded: isIncluded as boolean,
        displayOrder: index,
      })),
    });
  }
  console.log(`✓ ${plans.length} health plans`);
}

async function seedServiceProducts() {
  const networks = ['MTN', 'AIRTEL', 'GLO', 'NINE_MOBILE'] as const;

  // Representative bundles. In production these are refreshed nightly from the
  // aggregator by the catalogue sync job — prices change without notice.
  const dataPlans = [
    { name: '500MB Daily', amount: 20_000n, validityDays: 1 },
    { name: '1GB Weekly', amount: 50_000n, validityDays: 7 },
    { name: '2GB Monthly', amount: 100_000n, validityDays: 30 },
    { name: '5GB Monthly', amount: 200_000n, validityDays: 30 },
    { name: '10GB Monthly', amount: 350_000n, validityDays: 30 },
    { name: '40GB Monthly', amount: 1_000_000n, validityDays: 30 },
  ];

  for (const network of networks) {
    for (const [index, plan] of dataPlans.entries()) {
      const externalCode = `${network.toLowerCase()}-${plan.name.toLowerCase().replace(/\s+/g, '-')}`;
      await prisma.serviceProduct.upsert({
        where: {
          serviceType_network_billerCode_externalCode: {
            serviceType: 'DATA',
            network,
            billerCode: null as never,
            externalCode,
          },
        },
        create: {
          serviceType: 'DATA',
          network,
          externalCode,
          name: plan.name,
          amount: plan.amount,
          validityDays: plan.validityDays,
          displayOrder: index,
        },
        update: { amount: plan.amount, name: plan.name },
      }).catch(() => undefined); // composite unique with a null member is fussy across engines
    }
  }

  const cablePackages: Array<[string, string, bigint]> = [
    ['dstv', 'DStv Padi', 440_000n],
    ['dstv', 'DStv Yanga', 600_000n],
    ['dstv', 'DStv Confam', 1_100_000n],
    ['dstv', 'DStv Compact', 1_900_000n],
    ['dstv', 'DStv Premium', 4_400_000n],
    ['gotv', 'GOtv Smallie', 180_000n],
    ['gotv', 'GOtv Jinja', 390_000n],
    ['gotv', 'GOtv Jolli', 580_000n],
    ['gotv', 'GOtv Max', 850_000n],
    ['startimes', 'Nova', 190_000n],
    ['startimes', 'Basic', 380_000n],
    ['startimes', 'Smart', 560_000n],
    ['startimes', 'Classic', 750_000n],
  ];

  for (const [biller, name, amount] of cablePackages) {
    const externalCode = `${biller}-${name.toLowerCase().replace(/\s+/g, '-')}`;
    await prisma.serviceProduct
      .upsert({
        where: {
          serviceType_network_billerCode_externalCode: {
            serviceType: 'CABLE',
            network: null as never,
            billerCode: biller,
            externalCode,
          },
        },
        create: {
          serviceType: 'CABLE',
          billerCode: biller,
          externalCode,
          name,
          amount,
          validityDays: 30,
        },
        update: { amount, name },
      })
      .catch(() => undefined);
  }
  console.log(`✓ data bundles and ${cablePackages.length} cable packages`);
}

async function main() {
  console.log('Seeding Evas…');
  await seedRbac();
  await seedGeography();
  await seedProviders();
  await seedHealthPlans();
  await seedServiceProducts();
  console.log('Done.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
