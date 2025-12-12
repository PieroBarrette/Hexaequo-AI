export function initRoomFilters({ onChange } = {}) {
	const form = document.querySelector('[data-room-filters]');
	if (!form) {
		return () => {};
	}

	const inputs = Array.from(form.querySelectorAll('input, select'));
	const emitFilters = () => {
		const data = new FormData(form);
		onChange?.({
			timeMode: data.get('timeFilter') ?? 'any',
			allowSpectators: data.get('spectatorFilter') ?? 'any',
			sortOrder: data.get('sortOrder') ?? 'recent'
		});
	};

	inputs.forEach((input) => {
		input.addEventListener('change', emitFilters);
	});
	form.addEventListener('reset', () => {
		setTimeout(emitFilters, 0);
	});

	emitFilters();

	return () => {
		inputs.forEach((input) => input.removeEventListener('change', emitFilters));
		form.removeEventListener('reset', emitFilters);
	};
}
