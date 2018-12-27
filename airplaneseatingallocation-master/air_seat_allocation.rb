@name = <<~NUMBER
    50
    3 2
    4 3
    2 3
    3 4
NUMBER

@usr_input = @name.split("\n").map! {|x| x.split(" ").map! {|y| y.to_i}} # convert into integer
@passanger_count = @usr_input.delete_at(0)[0]

# size of matrix
@matrix_size = {
					column: @usr_input.transpose.map{|e| e.inject(:+)}[0].to_i,
					row: @usr_input.transpose.map{|e| e.max}[1].to_i 
}

# initialize matrix
@output = Array.new(@matrix_size[:column]){Array.new(@matrix_size[:row], "-C-")}.transpose

# column partition
sum = 0
@column_partition = @usr_input.map {|row| sum += row[0]}

#passanger calculation 1 upto @passanger_count
def assign_passanger
	@passanger_count-=1
	format('%03d', @passanger=@passanger.to_i+1) if @passanger_count>=0
end

#@invalid_seats = []
@window_seat = []
@middle_seat = []
@aisle_seat = []

# Mark invalid seats
def invalid_seat
	previous_col = 0
	upto_col = 0
	@usr_input.each do |col,row|
			upto_col+=col
			if @matrix_size[:row]-row >= 0
				(row...@matrix_size[:row]).each do |x|
					(previous_col...upto_col).each do |y|
						#@invalid_seats.push([x,y])
						@output[x][y] = "---" # mark invalid seats in output
					end
				end
				previous_col+=col
			end
	end
end
invalid_seat # method call

# Window, Middle seat array
# Assign Aisle seat
@output.each_with_index do |r,rindex|
	r.each_with_index do |c,cindex|
		unless @output[rindex][cindex]=="---"
			if (cindex.zero? || cindex==@matrix_size[:column]-1) && !(@usr_input.first.first-1).zero? && !(@usr_input.last.first-1).zero?
				# Window seat array
				@window_seat.push([rindex,cindex])
			else
				# Assign Aisle seat
				@column_partition.each do |e|
					@output[rindex][cindex] = assign_passanger if cindex==e-1 || cindex==e
				end
				# Middle seat array
				@middle_seat.push([rindex,cindex]) if @output[rindex][cindex]=="-C-"
			end
		end
	end
end

# Assign Passanger on Window seat
@window_seat.each do |val|
	@output[val[0]][val[1]] = assign_passanger if @passanger_count>0
end

# Assign Passanger on Middle seat
@middle_seat.each do |val|
	@output[val[0]][val[1]] = assign_passanger if @passanger_count>0
end

@output.each do |inner|
	#puts index
	puts inner.join(" ")
	
#TBD
=begin  
  #inner = inner.map {|e| puts e.to_i.join(" ") }
  @column_partition.each do |e|
  	#puts inner[e-1].join(" | ")
  end
=end
end

#@output.each_slice(3).map{|stripe| stripe.transpose.each_slice(3).map{|chunk| chunk.transpose}}.flatten(1)