export type Provider = '7tv' | 'bttv' | 'ffz';

export interface Image {
  url: string;
  /** Width in pixels, used for `srcset`. */
  width: number;
}

/** A 7TV, BetterTTV or FrankerFaceZ emote. */
export interface ThirdPartyEmote {
  provider: Provider;
  id: string;
  code: string;
  /** Size at 1x. */
  width: number;
  height: number;
  /** Smallest first. */
  images: Image[];
  /** Drawn on top of the emote before it. */
  zeroWidth: boolean;
  animated: boolean;
}

export type EmoteMap = ReadonlyMap<string, ThirdPartyEmote>;

export interface EmoteOptions {
  seventv: boolean;
  bttv: boolean;
  ffz: boolean;
}
