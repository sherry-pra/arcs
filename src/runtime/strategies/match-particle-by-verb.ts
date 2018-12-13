// Copyright (c) 2017 Google Inc. All rights reserved.
// This code may only be used under the BSD style license found at
// http://polymer.github.io/LICENSE.txt
// Code distributed by Google as part of this project is also
// subject to an additional IP rights grant found at
// http://polymer.github.io/PATENTS.txt

import {Strategy} from '../../planning/strategizer.js';
import {Recipe} from '../recipe/recipe.js';
import {Walker} from '../recipe/walker.js';
import {Arc} from '../arc.js';

export class MatchParticleByVerb extends Strategy {

  async generate(inputParams) {
    const arc = this.arc;
    return Recipe.over(this.getResults(inputParams), new class extends Walker {
      onParticle(recipe, particle) {
        if (particle.name) {
          // Particle already has explicit name.
          return undefined;
        }

        const modality = arc.modality;
        const particleSpecs = arc.context.findParticlesByVerb(particle.primaryVerb)
            .filter(spec => !modality || spec.matchModality(modality));

        return particleSpecs.map(spec => {
          return (recipe, particle) => {
            const score = 1;

            particle.name = spec.name;
            particle.spec = spec;

            return score;
          };
        });
      }
    }(Walker.Permuted), this);
  }
}