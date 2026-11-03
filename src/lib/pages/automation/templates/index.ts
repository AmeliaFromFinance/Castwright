// Ready-made actions for New action. Each file is a .cwactions package, so a template
// goes through the same import (and linking) as a shared file.
import type { ActionPackage } from '$lib/bindings/ActionPackage';
import type { Component } from 'svelte';
import { Clapperboard, Droplets, Film, Hand, Megaphone, MessageCircleHeart, Moon, Share2, Skull, Vote } from '@lucide/svelte';
import { parsePackage } from '../sharing';
import clip from './clip-command.json';
import deaths from './death-counter.json';
import firstChatter from './first-chatter-welcome.json';
import hydrate from './hydrate-reminder.json';
import lurk from './lurk-command.json';
import poll from './poll-command.json';
import credits from './roll-credits.json';
import redemption from './redemption-sound.json';
import raid from './shoutout-on-raid.json';
import socials from './socials-command.json';

export interface ActionTemplate {
  id: string;
  name: string;
  /** One line for the picker. */
  description: string;
  icon: Component;
  pkg: ActionPackage;
}

const t = (id: string, name: string, description: string, icon: Component, file: unknown): ActionTemplate => ({
  id,
  name,
  description,
  icon,
  pkg: parsePackage(JSON.stringify(file))
});

export const ACTION_TEMPLATES: readonly ActionTemplate[] = [
  t('shoutout-on-raid', 'Shoutout on raid', 'Raids of 5+ viewers get an announcement and a /shoutout', Megaphone, raid),
  t('death-counter', 'Death counter', '!death adds one (mods), !deaths shows it, !resetdeaths starts over', Skull, deaths),
  t('hydrate-reminder', 'Hydrate reminder', 'A water reminder in chat every 45 minutes while live', Droplets, hydrate),
  t('first-chatter-welcome', 'First-time chatter welcome', 'Greets people the first time they chat', MessageCircleHeart, firstChatter),
  t('lurk-command', 'Lurk command', '!lurk thanks the viewer for lurking', Moon, lurk),
  t('socials-command', 'Socials command', '!socials posts your links. Edit the text to add yours', Share2, socials),
  t('redemption-sound', 'Redemption sound', 'A channel point reward plays a sound and is completed', Hand, redemption),
  t('poll-command', 'Poll from chat', 'Mods start a poll with !poll Question | A | B', Vote, poll),
  t('roll-credits', 'Roll credits', 'Rolls the credits layer when the Ending scene shows', Clapperboard, credits),
  t('clip-command', 'Clip command', '!clip saves a clip and posts the link', Film, clip)
];

export function findTemplate(id: string): ActionTemplate | undefined {
  return ACTION_TEMPLATES.find((x) => x.id === id);
}

