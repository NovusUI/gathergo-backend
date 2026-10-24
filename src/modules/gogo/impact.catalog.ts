import { ImpactPathDefinition, SdgGoalDefinition } from './impact.types';

export const SDG_GOALS: SdgGoalDefinition[] = [
  {
    id: 'sdg_1',
    number: 1,
    title: 'No Poverty',
    shortTitle: 'No Poverty',
    color: '#E5243B',
  },
  {
    id: 'sdg_2',
    number: 2,
    title: 'Zero Hunger',
    shortTitle: 'Zero Hunger',
    color: '#DDA63A',
  },
  {
    id: 'sdg_3',
    number: 3,
    title: 'Good Health and Well-being',
    shortTitle: 'Health',
    color: '#4C9F38',
  },
  {
    id: 'sdg_4',
    number: 4,
    title: 'Quality Education',
    shortTitle: 'Education',
    color: '#C5192D',
  },
  {
    id: 'sdg_5',
    number: 5,
    title: 'Gender Equality',
    shortTitle: 'Gender Equality',
    color: '#FF3A21',
  },
  {
    id: 'sdg_6',
    number: 6,
    title: 'Clean Water and Sanitation',
    shortTitle: 'Water & Sanitation',
    color: '#26BDE2',
  },
  {
    id: 'sdg_7',
    number: 7,
    title: 'Affordable and Clean Energy',
    shortTitle: 'Clean Energy',
    color: '#FCC30B',
  },
  {
    id: 'sdg_8',
    number: 8,
    title: 'Decent Work and Economic Growth',
    shortTitle: 'Decent Work',
    color: '#A21942',
  },
  {
    id: 'sdg_9',
    number: 9,
    title: 'Industry, Innovation and Infrastructure',
    shortTitle: 'Innovation',
    color: '#FD6925',
  },
  {
    id: 'sdg_10',
    number: 10,
    title: 'Reduced Inequalities',
    shortTitle: 'Inclusion',
    color: '#DD1367',
  },
  {
    id: 'sdg_11',
    number: 11,
    title: 'Sustainable Cities and Communities',
    shortTitle: 'Communities',
    color: '#FD9D24',
  },
  {
    id: 'sdg_12',
    number: 12,
    title: 'Responsible Consumption and Production',
    shortTitle: 'Responsible Use',
    color: '#BF8B2E',
  },
  {
    id: 'sdg_13',
    number: 13,
    title: 'Climate Action',
    shortTitle: 'Climate Action',
    color: '#3F7E44',
  },
  {
    id: 'sdg_14',
    number: 14,
    title: 'Life Below Water',
    shortTitle: 'Life Below Water',
    color: '#0A97D9',
  },
  {
    id: 'sdg_15',
    number: 15,
    title: 'Life on Land',
    shortTitle: 'Life on Land',
    color: '#56C02B',
  },
  {
    id: 'sdg_16',
    number: 16,
    title: 'Peace, Justice and Strong Institutions',
    shortTitle: 'Peace & Justice',
    color: '#00689D',
  },
  {
    id: 'sdg_17',
    number: 17,
    title: 'Partnerships for the Goals',
    shortTitle: 'Partnerships',
    color: '#19486A',
  },
];

export const IMPACT_PATHS: ImpactPathDefinition[] = [
  {
    id: 'fundraising',
    title: 'Fundraising',
    summaryLabel: 'Fundraising',
    description: 'People give money directly toward a stated cause or goal.',
  },
  {
    id: 'proceeds_contribution',
    title: 'Proceeds Contribution',
    summaryLabel: 'Proceeds support',
    description:
      'Ticket or registration earnings are partly or fully committed to impact work.',
  },
  {
    id: 'direct_action',
    title: 'Direct Action',
    summaryLabel: 'Direct action',
    description:
      'Participants physically do the work, such as cleanup, outreach, planting, or service.',
  },
  {
    id: 'awareness_education',
    title: 'Awareness and Education',
    summaryLabel: 'Awareness',
    description:
      'The event teaches, informs, or shifts attention toward an issue.',
  },
  {
    id: 'creative_platform',
    title: 'Creative Platform',
    summaryLabel: 'Creative platform',
    description:
      'The event gives people visibility, audience access, or space to show their work.',
  },
  {
    id: 'resource_collection',
    title: 'Resource Collection',
    summaryLabel: 'Resource drive',
    description:
      'People bring or gather useful items such as food, books, clothes, tools, or supplies.',
  },
  {
    id: 'health_action',
    title: 'Health Action',
    summaryLabel: 'Health action',
    description:
      'The event supports health through screening, blood donation, wellness, or care access.',
  },
  {
    id: 'access_inclusion',
    title: 'Access and Inclusion',
    summaryLabel: 'Access',
    description:
      'The event opens space, opportunity, or participation for people with limited access.',
  },
  {
    id: 'sustainable_mobility',
    title: 'Sustainable Mobility',
    summaryLabel: 'Sustainable mobility',
    description:
      'The event itself is about lower-impact movement, walking, cycling, or shared transport.',
  },
];
