package arcs.api;

/**
 * Interface that all 'Native' built in particles must implement to create particles.
 */
public interface NativeParticleFactory {
    String getParticleName();
    NativeParticle createParticle();
}
