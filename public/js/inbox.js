(() => {
	document.addEventListener("DOMContentLoaded", () => {
		const stream = document.getElementById("chatMessageStream");
		if (stream) {
			stream.scrollTop = stream.scrollHeight;
		}
		const input = document.getElementById("chatMessageInput");
		if (input) {
			input.focus();
		}
	});
})();
