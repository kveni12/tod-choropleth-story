<script>
	import { createEventDispatcher } from 'svelte';
	import { stepObserver } from '$lib/utils/stepManager.js';

	export let steps = [];
	export let currentStep = 0;
		export let sources = [];

	const dispatch = createEventDispatcher();

	function handleEnter(index) {
		dispatch('stepchange', { index });
	}
</script>

<div class="narrative">
	<div class="narrative-intro">
		<p class="narrative-kicker">Scroll-driven reading</p>
		<p>
			Each section below activates a new map state. The goal is not just to show where housing changed,
			but to guide the reader toward the policy question behind TOD: where are new homes being added, and
			who is likely to benefit from that pattern of growth?
		</p>
	</div>

	{#each steps as step, index}
		<section
			use:stepObserver={{ index, onEnter: handleEnter, threshold: 0.56 }}
			class:step--active={currentStep === index}
			class="step"
			aria-current={currentStep === index ? 'step' : undefined}
		>
			<p class="step-kicker">{step.kicker}</p>
			<h2>{step.title}</h2>
			<p class="step-body">{step.body}</p>
			<p class="step-takeaway"><strong>Why it matters:</strong> {step.takeaway}</p>
		</section>
	{/each}

	<section class="sources">
		<h3>Sources</h3>
		<ul>
			{#each sources as source}
				<li>
					{#if source.url}
						<a href={source.url} target="_blank" rel="noreferrer">{source.label}</a>
					{:else}
						{source.label}
					{/if}
				</li>
			{/each}
		</ul>
	</section>
</div>

<style>
	.narrative {
		display: grid;
		gap: 2rem;
	}

	.narrative-intro {
		padding: 1rem 1.125rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: rgba(255, 253, 248, 0.7);
		color: var(--muted);
	}

	.narrative-kicker,
	.step-kicker {
		margin-bottom: 0.5rem;
		font-size: 0.76rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--accent);
	}

	.step {
		min-height: 82vh;
		padding: 1.4rem 1.2rem;
		border-left: 2px solid var(--line);
		opacity: 0.52;
		transform: translateY(16px);
		transition:
			opacity 220ms ease,
			transform 240ms ease,
			border-color 220ms ease;
	}

	.step--active {
		opacity: 1;
		transform: translateY(0);
		border-color: var(--accent);
	}

	.step h2 {
		margin-bottom: 0.9rem;
		font-size: clamp(1.55rem, 2vw, 2rem);
		line-height: 1.05;
	}

	.step-body,
	.step-takeaway,
	.sources li {
		color: var(--muted);
		font-size: 1rem;
		line-height: 1.7;
	}

	.step-takeaway {
		margin-top: 0.9rem;
		color: var(--ink);
	}

	.sources {
		padding: 1.25rem 1.125rem;
		border-top: 1px solid var(--line);
	}

	.sources h3 {
		margin-bottom: 0.8rem;
		font-size: 1rem;
	}

	.sources ul {
		padding-left: 1.2rem;
	}

	.sources a {
		color: var(--accent);
	}

	@media (max-width: 960px) {
		.step {
			min-height: 0;
			padding-left: 0.9rem;
		}
	}
</style>
