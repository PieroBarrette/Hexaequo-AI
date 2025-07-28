from flask import Flask, request, jsonify
from flask_cors import CORS
import logging
import copy

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(message)s')

# Log the received game state only once
logged_game_state = False

def log_move_differences(original_state, proposed_state):
    """
    Log the differences between the original game state and the proposed game state.

    Args:
        original_state (dict): The original game state.
        proposed_state (dict): The proposed game state after the AI's move.
    """
    differences = {
        'tiles': {},
        'pieces': {},
        'inventory': {},
        'captured': {},
        'activePlayer': None
    }

    # Compare tiles
    for position, tile in proposed_state['tiles'].items():
        if position not in original_state['tiles'] or original_state['tiles'][position] != tile:
            differences['tiles'][position] = tile

    for position in original_state['tiles']:
        if position not in proposed_state['tiles']:
            differences['tiles'][position] = None

    # Compare pieces
    for position, piece in proposed_state['pieces'].items():
        if position not in original_state['pieces'] or original_state['pieces'][position] != piece:
            differences['pieces'][position] = piece

    for position in original_state['pieces']:
        if position not in proposed_state['pieces']:
            differences['pieces'][position] = None

    # Compare inventory
    for player in ['black', 'white']:
        differences['inventory'][player] = {}
        for key in ['tiles', 'discs', 'rings']:
            if proposed_state['inventory'][player][key] != original_state['inventory'][player][key]:
                differences['inventory'][player][key] = proposed_state['inventory'][player][key]

    # Compare captured
    for key in ['black_discs', 'black_rings', 'white_discs', 'white_rings']:
        if proposed_state['captured'][key] != original_state['captured'][key]:
            differences['captured'][key] = proposed_state['captured'][key]

    # Compare active player
    if proposed_state['activePlayer'] != original_state['activePlayer']:
        differences['activePlayer'] = proposed_state['activePlayer']

    # Log the differences
    #logging.info(f"Differences between original and proposed state: {differences}")

@app.route('/process', methods=['POST'])
def process_game_state():
    global logged_game_state

    # Parse the incoming JSON game state
    game_state = request.get_json()

    # Log the game state only once
    if not logged_game_state:
        #logging.info(f"Received game state: {game_state}")
        logged_game_state = True

    if(game_state['activePlayer'] == 'black'):
        #logging.info("Active player is black. AI will not make a move.")
        return jsonify(game_state)

    # Determine the best move using Minimax
    best_move = None
    best_score = float('inf')  # Minimizing for white

    # Total pruned branches counter
    total_pruned_branches = 0

    # Generate direct children of the initial board state
    children = get_children(game_state, branch_prefix="1")

    # Ensure the minimizing player logic is correct
    for child in children:
        score, pruned = minimax(child, depth=5, alpha=float('-inf'), beta=float('inf'), maximizingPlayer=True, branch_prefix=child.get('branch', '1'))
        #logging.info(f"Child state score: {score}, MinimizingPlayer: True")
        total_pruned_branches += pruned

        # Update best_move and best_score for white
        if score < best_score:
            best_score = score
            best_move = child

    # Ensure the returned game state is properly formatted
    if not all(key in best_move for key in ['tiles', 'pieces', 'inventory', 'captured']):
        #logging.error("The chosen move is missing required keys. Returning the current state.")
        return jsonify(game_state)

    # Log the differences between the original and proposed game states
    log_move_differences(game_state, best_move)

    # Convert inventory and captured data to integers
    for player in ['black', 'white']:
        best_move['inventory'][player]['tiles'] = int(best_move['inventory'][player]['tiles']) if isinstance(best_move['inventory'][player]['tiles'], (int, float)) else sum(best_move['inventory'][player]['tiles'].values())
        best_move['inventory'][player]['discs'] = int(best_move['inventory'][player]['discs']) if isinstance(best_move['inventory'][player]['discs'], (int, float)) else sum(best_move['inventory'][player]['discs'].values())
        best_move['inventory'][player]['rings'] = int(best_move['inventory'][player]['rings']) if isinstance(best_move['inventory'][player]['rings'], (int, float)) else sum(best_move['inventory'][player]['rings'].values())
        best_move['captured'][f'{player}_discs'] = int(best_move['captured'][f'{player}_discs']) if isinstance(best_move['captured'][f'{player}_discs'], (int, float)) else sum(best_move['captured'][f'{player}_discs'].values())
        best_move['captured'][f'{player}_rings'] = int(best_move['captured'][f'{player}_rings']) if isinstance(best_move['captured'][f'{player}_rings'], (int, float)) else sum(best_move['captured'][f'{player}_rings'].values())

    # Switch the active player to the opponent after the AI's move
    best_move['activePlayer'] = 'black'

    # Log the total number of branches pruned during the Minimax execution
    logging.info(f"Total branches pruned during Minimax execution: {total_pruned_branches}")

    # Return the updated game state with the chosen move
    return jsonify(best_move)

def minimax(state, depth, alpha, beta, maximizingPlayer, branch_prefix):
    """
    Simplified Minimax algorithm with Alpha-Beta Pruning to determine the best move.

    Args:
        state (dict): The current game state.
        depth (int): The depth limit for the search.
        alpha (float): The alpha value for pruning.
        beta (float): The beta value for pruning.
        maximizingPlayer (bool): True if the current player is maximizing, False otherwise.
        branch_prefix (str): The branch prefix for logging.

    Returns:
        float: The evaluation score of the best move.
    """
    # Check for terminal state or depth limit
    if depth == 0 or is_terminal(state):
        score = evaluate(state)
        #logging.info(f"Branch: {branch_prefix}, Depth: {depth}, Terminal/Leaf Node Score: {score}")
        return score, 0  # Return 0 pruned branches at leaf nodes

    pruned_branches = 0

    if maximizingPlayer:
        maxEval = float('-inf')
        for child in get_children(state, branch_prefix):
            eval, child_pruned_branches = minimax(child, depth - 1, alpha, beta, maximizingPlayer=False, branch_prefix=child.get('branch', branch_prefix))
            maxEval = max(maxEval, eval)
            pruned_branches += child_pruned_branches
            if maxEval >= beta:
                pruned_branches += 1
                #logging.info(f"Branch: {branch_prefix}, Depth: {depth}, Pruned (Maximizing): Alpha={alpha}, Beta={beta}")
                break
            alpha = max(alpha, maxEval)
        #logging.info(f"Branch: {branch_prefix}, Depth: {depth}, Maximizing Eval: {maxEval}, Alpha={alpha}, Beta={beta}")
        return maxEval, pruned_branches
    else:
        minEval = float('inf')
        for child in get_children(state, branch_prefix):
            eval, child_pruned_branches = minimax(child, depth - 1, alpha, beta, maximizingPlayer=True, branch_prefix=child.get('branch', branch_prefix))
            minEval = min(minEval, eval)
            pruned_branches += child_pruned_branches
            if minEval <= alpha:
                pruned_branches += 1
                #logging.info(f"Branch: {branch_prefix}, Depth: {depth}, Pruned (Minimizing): Alpha={alpha}, Beta={beta}")
                break
            beta = min(beta, minEval)
        #logging.info(f"Branch: {branch_prefix}, Depth: {depth}, Minimizing Eval: {minEval}, Alpha={alpha}, Beta={beta}")
        return minEval, pruned_branches

def is_terminal(state):
    # Victory conditions:
    # 1. A player has 6 captured discs
    # 2. A player has 3 captured rings
    # 3. A player has no active pieces on the board

    # Check if either player has no active pieces, but not both at the same time
    black_has_pieces = any(piece for piece in state['pieces'].values() if piece['color'] == 'black' and piece['type'] in ['disc', 'ring'])
    white_has_pieces = any(piece for piece in state['pieces'].values() if piece['color'] == 'white' and piece['type'] in ['disc', 'ring'])

    terminal = (
        state['captured']['black_discs'] >= 6 or
        state['captured']['white_discs'] >= 6 or
        state['captured']['black_rings'] >= 3 or
        state['captured']['white_rings'] >= 3 or
        not black_has_pieces or not white_has_pieces
    )
    return terminal

def evaluate(state):
    black_score = 0
    white_score = 0

    # Score pieces on the board
    for position, piece in state['pieces'].items():
        if piece['type'] == 'disc':
            if piece['color'] == 'black':
                black_score += 1
            else:
                white_score += 1
        elif piece['type'] == 'ring':
            if piece['color'] == 'black':
                black_score += 3
            else:
                white_score += 3

    # Score captured pieces
    black_score += int(state['captured']['black_discs']) * 1.5
    black_score += int(state['captured']['black_rings']) * 4.5
    white_score += int(state['captured']['white_discs']) * 1.5
    white_score += int(state['captured']['white_rings']) * 4.5

    # Score empty tiles of own color
    for position, tile_color in state['tiles'].items():
        if position not in state['pieces']:
            if tile_color == 'black':
                black_score += 0.2
            elif tile_color == 'white':
                white_score += 0.2

    # # Detect threats on discs and rings
    # threat_score_black = 0
    # threat_score_white = 0
    # opponent = 'white' if state['activePlayer'] == 'black' else 'black'

    # # Simulate opponent's moves to detect threats
    # opponent_moves = get_children(state)
    # for move in opponent_moves:
    #     for position, piece in move['pieces'].items():
    #         if piece['type'] == 'disc' and piece['color'] == state['activePlayer']:
    #             if state['activePlayer'] == 'black':
    #                 threat_score_black += 0.25
    #             else:
    #                 threat_score_white += 0.25
    #         elif piece['type'] == 'ring' and piece['color'] == state['activePlayer']:
    #             if state['activePlayer'] == 'black':
    #                 threat_score_black += 0.75
    #             else:
    #                 threat_score_white += 0.75

    # # Adjust scores based on threats
    # black_score -= threat_score_black
    # white_score -= threat_score_white

    # black_moves = len(get_children(state)
    #white_moves = len(get_children(state)
    #black_score += black_moves * 0.1
    #white_score += white_moves * 0.1

    # Log mobility scores
    #logging.info(f"Mobility: Black={black_moves} moves, White={white_moves} moves")

    score = black_score - white_score

    #logging.info(f"Score breakdown: Black={black_score}, White={white_score}, Final Score={score}")
    black_has_pieces = any(piece for piece in state['pieces'].values() if piece['color'] == 'black' and piece['type'] in ['disc', 'ring'])
    white_has_pieces = any(piece for piece in state['pieces'].values() if piece['color'] == 'white' and piece['type'] in ['disc', 'ring'])

    
    if state['captured']['black_discs'] >= 6 or state['captured']['black_rings'] >= 3 or not white_has_pieces:
        return float('inf')
    elif state['captured']['white_discs'] >= 6 or state['captured']['white_rings'] >= 3 or not black_has_pieces:
        return float('-inf')

    return score

def get_children(state, branch_prefix):
    children = []
    player = state['activePlayer']

    # Generate all possible moves for the current player
    ring_moves = get_valid_ring_moves(state, player)
    disc_jumps = get_valid_disc_jumps(state, player)
    disc_moves = get_valid_disc_moves(state, player)
    ring_placements = get_valid_ring_placements(state, player)
    disc_placements = get_valid_disc_placements(state, player)
    tile_placements = get_valid_tile_placements(state, player)


    #logging.info(f"Branch: {branch_prefix}, Score: {evaluate(state)}, Valid moves: tiles={tile_placements}, discs={disc_placements}, rings={ring_placements}, disc_moves={disc_moves}, disc_jumps={disc_jumps}, ring_moves={ring_moves}")

    # Simulate each move and add the resulting state to children
    move_index = 1
    for from_position, to_position in ring_moves:
        new_state = copy.deepcopy(state)
        simulate_ring_move(new_state, from_position, to_position)
        new_state['activePlayer'] = 'white' if player == 'black' else 'black'
        new_state['branch'] = f"{branch_prefix}.{move_index}"
        #logging.info(f"Branch: {new_state['branch']}, {player} moves ring: {from_position}->{to_position}, Score: {evaluate(new_state)}")
        children.append(new_state)
        move_index += 1

    for jump_sequence in disc_jumps:
        new_state = copy.deepcopy(state)
        simulate_disc_jump_sequence(new_state, jump_sequence)
        new_state['activePlayer'] = 'white' if player == 'black' else 'black'
        new_state['branch'] = f"{branch_prefix}.{move_index}"
        #logging.info(f"Branch: {new_state['branch']}, {player} jumps: {jump_sequence}, Score: {evaluate(new_state)}")
        children.append(new_state)
        move_index += 1
    
    for from_position, to_position in disc_moves:
        if from_position not in state['pieces']:
            #logging.error(f"Invalid move: from_position {from_position} does not exist in state['pieces'].")
            continue
        new_state = copy.deepcopy(state)
        simulate_disc_move(new_state, from_position, to_position)
        new_state['activePlayer'] = 'white' if player == 'black' else 'black'
        new_state['branch'] = f"{branch_prefix}.{move_index}"
        #logging.info(f"Branch: {new_state['branch']}, {player} moves disc: {from_position}->{to_position}, Score: {evaluate(new_state)}")
        children.append(new_state)
        move_index += 1

    for position in ring_placements:
        new_state = copy.deepcopy(state)
        simulate_ring_placement(new_state, position, player)
        new_state['activePlayer'] = 'white' if player == 'black' else 'black'
        new_state['branch'] = f"{branch_prefix}.{move_index}"
        #logging.info(f"Branch: {new_state['branch']}, {player} places ring at: {position}, Score: {evaluate(new_state)}")
        children.append(new_state)
        move_index += 1

    for position in disc_placements:
        new_state = copy.deepcopy(state)
        simulate_disc_placement(new_state, position, player)
        new_state['activePlayer'] = 'white' if player == 'black' else 'black'
        new_state['branch'] = f"{branch_prefix}.{move_index}"
        #logging.info(f"Branch: {new_state['branch']}, {player} places disc at: {position}, Score: {evaluate(new_state)}")
        children.append(new_state)
        move_index += 1

    for position in tile_placements:
        new_state = copy.deepcopy(state)
        simulate_tile_placement(new_state, position, player)
        new_state['activePlayer'] = 'white' if player == 'black' else 'black'
        new_state['branch'] = f"{branch_prefix}.{move_index}"
        #logging.info(f"Branch: {new_state['branch']}, {player} places tile at: {position}, Score: {evaluate(new_state)}")
        children.append(new_state)
        move_index += 1

    return children

def simulate_tile_placement(state, position, player):
    """
    Simulate placing a tile and return a new simulated game state.

    Args:
        state (dict): The current game state.
        position (str): The position where the tile is placed.
        player (str): The current player ('black' or 'white').

    Returns:
        dict: A simulated game state after placing the tile.
    """
    # Place the tile on the board
    state['tiles'][position] = player

    # Decrease the player's tile inventory
    state['inventory'][player]['tiles'] -= 1

    return state

def simulate_disc_placement(state, position, player):
    """
    Simulate placing a disc and return a new simulated game state.

    Args:
        state (dict): The current game state.
        position (str): The position where the disc is placed.
        player (str): The current player ('black' or 'white').

    Returns:
        dict: A simulated game state after placing the disc.
    """
    # Place the disc on the board
    state['pieces'][position] = {
        'type': 'disc',
        'color': player
    }

    # Decrease the player's disc inventory
    state['inventory'][player]['discs'] -= 1

    return state

def simulate_ring_placement(state, position, player):
    """
    Simulate placing a ring and return the new game state.

    Args:
        state (dict): The current game state.
        position (str): The position where the ring is placed.
        player (str): The current player ('black' or 'white').

    Returns:
        dict: The new game state after placing the ring.
    """
    # Place the ring on the board
    state['pieces'][position] = {
        'type': 'ring',
        'color': player
    }

    # Decrease the player's ring inventory
    state['inventory'][player]['rings'] -= 1

    # Return one captured disc to the opponent's inventory
    opponent = 'white' if player == 'black' else 'black'
    state['captured'][f'{player}_discs'] -= 1
    state['inventory'][opponent]['discs'] += 1

    return state

def simulate_disc_move(state, from_position, to_position):

    """
    Simulate moving a disc and return a new simulated game state.

    Args:
        state (dict): The current game state.
        from_position (str): The starting position of the disc as a string "q,r".
        to_position (str): The target position of the disc as a string "q,r".

    Returns:
        dict: A simulated game state after moving the disc.
    """

    # Ensure positions are strings in "q,r" format
    if isinstance(from_position, tuple):
        from_position = f"{from_position[0]},{from_position[1]}"
    if isinstance(to_position, tuple):
        to_position = f"{to_position[0]},{to_position[1]}"
    # Move the disc to the new position
    state['pieces'][to_position] = state['pieces'].pop(from_position)

    return state

def simulate_jump(state, from_position, over_position, to_position):
    """
    Simulate a jump move and directly modify the state.

    Args:
        state (dict): The current game state.
        from_position (str): The starting position of the jump.
        over_position (str): The position of the piece being jumped over.
        to_position (str): The landing position of the jump.

    Returns:
        None
    """

    if from_position not in state['pieces']:
        #logging.error(f"Invalid jump: from_position {from_position} does not exist in state['pieces'].")
        return

    if over_position in state['pieces']:
        over_piece = state['pieces'][over_position]
        from_piece = state['pieces'][from_position]
        if over_piece['color'] != from_piece['color']:
            del state['pieces'][over_position]
            if over_piece['type'] == 'disc':
                state['captured'][f"{from_piece['color']}_discs"] += 1
            if over_piece['type'] == 'ring':
                state['captured'][f"{from_piece['color']}_rings"] += 1
    state['pieces'][to_position] = state['pieces'].pop(from_position)

    return state

def simulate_disc_jump_sequence(state, jump_sequence):
    """
    Simulate a sequence of disc jumps using simulate_jump and return the resulting game state.

    Args:
        state (dict): The current game state.
        jump_sequence (list): A list of positions as strings "q,r" representing the jump sequence.

    Returns:
        dict: A simulated game state after the jump sequence.
    """
    for i in range(len(jump_sequence) - 1):
        from_position = jump_sequence[i]
        to_position = jump_sequence[i + 1]

        if isinstance(from_position, tuple):
            from_position = f"{from_position[0]},{from_position[1]}"
        if isinstance(to_position, tuple):
            to_position = f"{to_position[0]},{to_position[1]}"

        # Calculate the position of the piece being jumped over
        from_q, from_r = map(int, from_position.split(','))
        to_q, to_r = map(int, to_position.split(','))
        over_position = f"{(from_q + to_q) // 2},{(from_r + to_r) // 2}"

        #logging.info(f"Simulating jump: from {from_position}, over {over_position}, to {to_position}")
        #logging.info(f"State of pieces before jump: {state['pieces']}")

        simulate_jump(state, from_position, over_position, to_position)

    return state

def simulate_ring_move(state, from_position, to_position):
    """
    Simulate moving a ring and return the new game state.

    Args:
        state (dict): The current game state.
        from_position (tuple): The starting position of the ring.
        to_position (tuple): The target position of the ring.

    Returns:
        dict: The new game state after moving the ring.
    """
    # Check if the target position contains an opponent's piece
    if to_position in state['pieces'] and state['pieces'][to_position]['color'] != state['pieces'][from_position]['color']:
        # Capture the opponent's piece
        captured_piece = state['pieces'].pop(to_position)
        if captured_piece['type'] == 'disc':
            state['captured'][f"{captured_piece['color']}_discs"] += 1
        elif captured_piece['type'] == 'ring':
            state['captured'][f"{captured_piece['color']}_rings"] += 1

    # Move the ring to the new position
    state['pieces'][to_position] = state['pieces'].pop(from_position)

    return state

def get_valid_tile_placements(state, player):
    valid_positions = set()

    # Only allow tile placement if player has tiles left
    tiles_left = state['inventory'][player]['tiles']
    if isinstance(tiles_left, dict):
        tiles_left = tiles_left.get('tiles', 0)

    if tiles_left <= 0:
        #logging.info("No tiles left in inventory.")
        return []

    # Collect all empty neighboring positions of existing tiles
    empty_neighbors = set()
    for position in state['tiles']:
        if isinstance(position, tuple):
            position = f"{position[0]},{position[1]}"  # Ensure position is a string
        for neighbor in get_neighbors(position):
            if neighbor not in state['tiles']:
                empty_neighbors.add(neighbor)

    # For each empty neighbor, check if it has at least 2 adjacent tiles
    for position in empty_neighbors:
        adjacent_count = 0
        for neighbor in get_neighbors(position):
            if neighbor in state['tiles']:
                adjacent_count += 1
        if adjacent_count >= 2:
            valid_positions.add(position)

    return list(valid_positions)

def get_neighbors(position):
    """
    Get neighboring positions for a given position on a hexagonal grid using axial coordinates.

    Args:
        position (str): The position as a string "q,r".

    Returns:
        list: A list of neighboring positions as strings "q,r".
    """
    if isinstance(position, tuple):
        position = f"{position[0]},{position[1]}"  # Convert tuple to string

    q, r = map(int, position.split(','))
    directions = [(1, 0), (1, -1), (0, -1), (-1, 0), (-1, 1), (0, 1)]
    neighbors = [f"{q + dq},{r + dr}" for dq, dr in directions]
    return neighbors

def get_valid_disc_placements(state, player):
    valid_positions = []

    # Check if the player has at least one disc in their inventory
    if isinstance(state['inventory'][player], dict) and state['inventory'][player].get('discs', 0) > 0:
        # Loop through all board positions
        for position, tile_color in state['tiles'].items():
            if tile_color == player and position not in state['pieces']:  # Check if the tile is empty and of the player's color
                valid_positions.append(position)

    return valid_positions

def get_valid_ring_placements(state, player):
    valid_positions = []

    # Check if the player has a ring and a captured disc to return
    if state['inventory'][player]['rings'] > 0 and state['captured'][f'{player}_discs'] > 0:
        # Loop through all board positions
        for position, tile_color in state['tiles'].items():
            if tile_color == player and position not in state['pieces']:  # Check if the tile is empty and of the player's color
                valid_positions.append(position)

    return valid_positions

def get_valid_disc_moves(state, player):
    valid_moves = []

    # Loop through all pieces on the board
    for position, piece in state['pieces'].items():
        if isinstance(position, tuple):
            position = f"{position[0]},{position[1]}"  # Ensure position is a string
        if piece['type'] == 'disc' and piece['color'] == player:  # Check if the piece is a disc belonging to the player
            for neighbor in get_neighbors(position):
                if neighbor in state['tiles'] and state['tiles'][neighbor] not in [None, ''] and neighbor not in state['pieces']:  # Ensure valid tile and empty
                    valid_moves.append((position, neighbor))

    return valid_moves

def get_valid_disc_jumps(state, player):
    valid_jumps = []

    # Create a copy of state['pieces'] to avoid modification during iteration
    pieces_copy = state['pieces'].copy()

    # Helper function to recursively find all jump sequences
    def find_jumps(current_state, current_position, jump_sequence, visited, jumped_pieces):
        has_jump = False

        # Ensure current_position is a string "q,r"
        if isinstance(current_position, tuple):
            current_position = f"{current_position[0]},{current_position[1]}"

        # Ensure current_state['pieces'] is not None
        if not current_state or 'pieces' not in current_state or current_state['pieces'] is None:
            #logging.error("current_state['pieces'] is None or invalid. Aborting jump search.")
            return

        for neighbor in get_neighbors(current_position):
            # Ensure neighbor is a string "q,r"
            if isinstance(neighbor, tuple):
                neighbor = f"{neighbor[0]},{neighbor[1]}"

            # Check if the neighbor is a piece (opponent or friendly, but not empty)
            if neighbor in current_state['pieces'] and current_state['pieces'][neighbor]['type'] in ['disc', 'ring']:
                # Calculate the landing position
                dx = int(neighbor.split(',')[0]) - int(current_position.split(',')[0])
                dy = int(neighbor.split(',')[1]) - int(current_position.split(',')[1])
                landing_q = int(current_position.split(',')[0]) + 2 * dx
                landing_r = int(current_position.split(',')[1]) + 2 * dy
                landing_position = f"{landing_q},{landing_r}"

                # Check if the landing position is valid and prevent immediate reverse jumps
                if (
                    landing_position in current_state['tiles'] and
                    landing_position not in current_state['pieces'] and
                    neighbor not in jumped_pieces
                ):
                    has_jump = True

                    # Simulate the jump using a deep copy of the current state
                    new_state = copy.deepcopy(current_state)
                    simulate_jump(new_state, current_position, neighbor, landing_position)
                    find_jumps(
                        new_state,
                        landing_position,
                        jump_sequence + [landing_position],
                        visited | {landing_position},
                        jumped_pieces | {neighbor}
                    )

        # If no further jumps are possible, add the jump sequence to valid jumps
        if not has_jump and len(jump_sequence) > 1:
            valid_jumps.append(jump_sequence)

    # Loop through all pieces on the board using the copy
    for position, piece in pieces_copy.items():
        # Ensure position is a string "q,r"
        if isinstance(position, tuple):
            position_str = f"{position[0]},{position[1]}"
        else:
            position_str = position

        if piece['type'] == 'disc' and piece['color'] == player:
            find_jumps(state, position_str, [position_str], {position_str}, set())

    return valid_jumps

def get_valid_ring_moves(state, player):
    valid_moves = []

    # Define the 12 possible directions for a ring to move exactly 2 tiles away
    directions = [
        (-2, 0), (2, 0),  # Horizontal
        (0, -2), (0, 2),  # Vertical
        (-2, -2), (2, 2),  # Diagonal top-left to bottom-right
        (-2, 2), (2, -2),  # Diagonal top-right to bottom-left
        (-1, -2), (-1, 2),  # L-shaped moves
        (1, -2), (1, 2)    # L-shaped moves
    ]

    # Loop through all pieces on the board
    for position, piece in state['pieces'].items():
        if piece['type'] == 'ring' and piece['color'] == player:  # Check if the piece is a ring belonging to the player
            for dx, dy in directions:
                # Ensure position is a tuple of integers
                if isinstance(position, str):
                    q, r = map(int, position.split(','))
                else:
                    q, r = position

                # Calculate the landing position
                landing_position = f"{q + dx},{r + dy}"

                # Check if the landing position is valid
                if landing_position in state['tiles']:
                    if landing_position not in state['pieces']:  # Empty tile
                        valid_moves.append((position, landing_position))
                    elif state['pieces'][landing_position]['color'] != player:  # Enemy piece to capture
                        valid_moves.append((position, landing_position))

    return valid_moves

if __name__ == '__main__':
    app.run(debug=True)
